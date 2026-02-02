//! Test utilities for creating real VCS repositories.
//!
//! This module provides infrastructure for integration tests that need
//! real jj and git repositories.

use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use tempfile::TempDir;

use jj_lib::config::{ConfigLayer, ConfigSource, StackedConfig};
use jj_lib::repo::{ReadonlyRepo, StoreFactories};
use jj_lib::settings::UserSettings;
use jj_lib::workspace::{default_working_copy_factories, Workspace};

use crate::vcs::{JjBackend, VcsBackend, VcsError, VcsResult};

/// Common operations for test repositories.
pub trait TestRepo {
    /// Returns the root path of the repository.
    fn path(&self) -> &Path;

    /// Creates a file with the given content.
    fn write_file(&self, relative_path: &str, content: &str) -> io::Result<()> {
        let full_path = self.path().join(relative_path);
        if let Some(parent) = full_path.parent() {
            fs::create_dir_all(parent)?;
        }
        fs::write(full_path, content)
    }

    /// Reads the content of a file.
    fn read_file(&self, relative_path: &str) -> io::Result<String> {
        fs::read_to_string(self.path().join(relative_path))
    }

    /// Deletes a file.
    fn delete_file(&self, relative_path: &str) -> io::Result<()> {
        fs::remove_file(self.path().join(relative_path))
    }

    /// Checks if a file exists.
    fn file_exists(&self, relative_path: &str) -> bool {
        self.path().join(relative_path).exists()
    }
}

/// A test jj repository backed by a temporary directory.
pub struct JjTestRepo {
    #[allow(dead_code)]
    tempdir: TempDir,
    root: PathBuf,
    #[allow(dead_code)]
    settings: UserSettings,
}

impl JjTestRepo {
    /// Creates a new jj repository in a temporary directory.
    pub fn new() -> VcsResult<Self> {
        let tempdir = TempDir::new().map_err(VcsError::Io)?;
        let root = tempdir.path().to_path_buf();
        let settings = create_test_settings()?;

        // Initialize internal git backend (most common for jj)
        Workspace::init_internal_git(&settings, &root)
            .map_err(|e| VcsError::Jj(format!("init: {e}")))?;

        Ok(Self {
            tempdir,
            root,
            settings,
        })
    }

    /// Returns a VcsBackend for this repository.
    pub fn backend(&self) -> VcsResult<JjBackend> {
        JjBackend::open(&self.root)
    }

    /// Returns a boxed VcsBackend trait object.
    #[allow(dead_code)]
    pub fn backend_boxed(&self) -> VcsResult<Box<dyn VcsBackend>> {
        Ok(Box::new(self.backend()?))
    }

    /// Loads the workspace and repo for direct jj-lib operations.
    #[allow(dead_code)]
    pub fn load_repo(&self) -> VcsResult<(Workspace, Arc<ReadonlyRepo>)> {
        let workspace = Workspace::load(
            &self.settings,
            &self.root,
            &StoreFactories::default(),
            &default_working_copy_factories(),
        )
        .map_err(|e| VcsError::Jj(format!("load workspace: {e}")))?;

        let repo = workspace
            .repo_loader()
            .load_at_head()
            .map_err(|e| VcsError::Jj(format!("load repo: {e}")))?;

        Ok((workspace, repo))
    }

    /// Convenience method to commit the current working copy with a message.
    /// Uses jj CLI to ensure working copy is snapshotted.
    pub fn commit(&self, message: &str) -> VcsResult<String> {
        // Use jj CLI to describe + new, which triggers a snapshot
        let output = std::process::Command::new("jj")
            .args(["describe", "-m", message])
            .current_dir(&self.root)
            .output()
            .map_err(VcsError::Io)?;

        if !output.status.success() {
            return Err(VcsError::Jj(format!(
                "jj describe failed: {}",
                String::from_utf8_lossy(&output.stderr)
            )));
        }

        let output = std::process::Command::new("jj")
            .args(["new"])
            .current_dir(&self.root)
            .output()
            .map_err(VcsError::Io)?;

        if !output.status.success() {
            return Err(VcsError::Jj(format!(
                "jj new failed: {}",
                String::from_utf8_lossy(&output.stderr)
            )));
        }

        // Get the change id of the described commit (parent of @)
        let output = std::process::Command::new("jj")
            .args(["log", "-r", "@-", "--no-graph", "-T", "change_id.short(12)"])
            .current_dir(&self.root)
            .output()
            .map_err(VcsError::Io)?;

        Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
    }

    /// Triggers a working copy snapshot (jj status does this).
    pub fn snapshot(&self) -> VcsResult<()> {
        let output = std::process::Command::new("jj")
            .args(["status"])
            .current_dir(&self.root)
            .output()
            .map_err(VcsError::Io)?;

        if !output.status.success() {
            return Err(VcsError::Jj(format!(
                "jj status failed: {}",
                String::from_utf8_lossy(&output.stderr)
            )));
        }
        Ok(())
    }
}

impl TestRepo for JjTestRepo {
    fn path(&self) -> &Path {
        &self.root
    }
}

/// A test git repository backed by a temporary directory.
/// Uses std::process::Command to run git commands (no gix dependency yet).
pub struct GitTestRepo {
    #[allow(dead_code)]
    tempdir: TempDir,
    root: PathBuf,
}

impl GitTestRepo {
    /// Creates a new git repository in a temporary directory.
    pub fn new() -> io::Result<Self> {
        let tempdir = TempDir::new()?;
        let root = tempdir.path().to_path_buf();

        // Initialize git repo
        let output = std::process::Command::new("git")
            .args(["init"])
            .current_dir(&root)
            .output()?;

        if !output.status.success() {
            return Err(io::Error::other(format!(
                "git init failed: {}",
                String::from_utf8_lossy(&output.stderr)
            )));
        }

        // Configure user for commits
        std::process::Command::new("git")
            .args(["config", "user.name", "Test User"])
            .current_dir(&root)
            .output()?;

        std::process::Command::new("git")
            .args(["config", "user.email", "test@example.com"])
            .current_dir(&root)
            .output()?;

        Ok(Self { tempdir, root })
    }

    /// Stages all changes.
    pub fn add_all(&self) -> io::Result<()> {
        let output = std::process::Command::new("git")
            .args(["add", "-A"])
            .current_dir(&self.root)
            .output()?;

        if !output.status.success() {
            return Err(io::Error::other(format!(
                "git add failed: {}",
                String::from_utf8_lossy(&output.stderr)
            )));
        }
        Ok(())
    }

    /// Commits staged changes with a message.
    pub fn commit(&self, message: &str) -> io::Result<String> {
        self.add_all()?;

        let output = std::process::Command::new("git")
            .args(["commit", "-m", message, "--allow-empty"])
            .current_dir(&self.root)
            .output()?;

        if !output.status.success() {
            return Err(io::Error::other(format!(
                "git commit failed: {}",
                String::from_utf8_lossy(&output.stderr)
            )));
        }

        // Get the commit hash
        let output = std::process::Command::new("git")
            .args(["rev-parse", "HEAD"])
            .current_dir(&self.root)
            .output()?;

        Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
    }

    /// Gets the current HEAD commit hash.
    pub fn head(&self) -> io::Result<String> {
        let output = std::process::Command::new("git")
            .args(["rev-parse", "HEAD"])
            .current_dir(&self.root)
            .output()?;

        if !output.status.success() {
            return Err(io::Error::other("git rev-parse HEAD failed"));
        }

        Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
    }
}

impl TestRepo for GitTestRepo {
    fn path(&self) -> &Path {
        &self.root
    }
}

fn create_test_settings() -> VcsResult<UserSettings> {
    let mut config = StackedConfig::with_defaults();

    let mut user_layer = ConfigLayer::empty(ConfigSource::User);
    user_layer
        .set_value("user.name", "Test User")
        .map_err(|e| VcsError::Jj(format!("set user.name: {e}")))?;
    user_layer
        .set_value("user.email", "test@example.com")
        .map_err(|e| VcsError::Jj(format!("set user.email: {e}")))?;
    config.add_layer(user_layer);

    UserSettings::from_config(config).map_err(|e| VcsError::Jj(format!("settings: {e}")))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_jj_test_repo_creation() {
        let repo = JjTestRepo::new().unwrap();
        assert!(repo.path().join(".jj").exists());
    }

    #[test]
    fn test_jj_test_repo_write_and_read_file() {
        let repo = JjTestRepo::new().unwrap();
        repo.write_file("test.txt", "hello world").unwrap();
        assert_eq!(repo.read_file("test.txt").unwrap(), "hello world");
    }

    #[test]
    fn test_jj_test_repo_nested_file() {
        let repo = JjTestRepo::new().unwrap();
        repo.write_file("src/lib/mod.rs", "// module").unwrap();
        assert!(repo.file_exists("src/lib/mod.rs"));
    }

    #[test]
    fn test_jj_test_repo_delete_file() {
        let repo = JjTestRepo::new().unwrap();
        repo.write_file("delete_me.txt", "bye").unwrap();
        assert!(repo.file_exists("delete_me.txt"));
        repo.delete_file("delete_me.txt").unwrap();
        assert!(!repo.file_exists("delete_me.txt"));
    }

    #[test]
    fn test_jj_test_repo_backend() {
        let repo = JjTestRepo::new().unwrap();
        let backend = repo.backend().unwrap();
        let status = backend.status().unwrap();
        assert!(status.working_copy_id.is_some());
    }

    #[test]
    fn test_git_test_repo_creation() {
        let repo = GitTestRepo::new().unwrap();
        assert!(repo.path().join(".git").exists());
    }

    #[test]
    fn test_git_test_repo_commit() {
        let repo = GitTestRepo::new().unwrap();
        repo.write_file("README.md", "# Test").unwrap();
        let hash = repo.commit("Initial commit").unwrap();
        assert!(!hash.is_empty());
        assert_eq!(repo.head().unwrap(), hash);
    }
}
