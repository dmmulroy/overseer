use rusqlite::{Connection, Result};

pub fn open(path: &str) -> Result<Connection> {
    let conn = Connection::open(path)?;
    conn.pragma_update(None, "journal_mode", "WAL")?;
    conn.pragma_update(None, "busy_timeout", 5000)?;
    Ok(conn)
}

pub fn migrate(conn: &Connection) -> Result<()> {
    let sql = include_str!("../migrations/0001_init.sql");
    conn.execute_batch(sql)?;
    Ok(())
}

pub fn open_and_migrate(path: &str) -> Result<Connection> {
    let conn = open(path)?;
    migrate(&conn)?;
    Ok(conn)
}

pub fn with_test_db() -> Result<Connection> {
    let conn = Connection::open_in_memory()?;
    conn.pragma_update(None, "journal_mode", "WAL")?;
    conn.pragma_update(None, "busy_timeout", 5000)?;
    migrate(&conn)?;
    Ok(conn)
}
