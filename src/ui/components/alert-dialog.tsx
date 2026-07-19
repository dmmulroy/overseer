import { AlertDialog as AlertDialogPrimitive } from "@base-ui/react/alert-dialog";
import type * as React from "react";

import { Button } from "@/ui/components/button";

type AlertDialogProps = {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly title: string;
  readonly description: string;
  readonly icon?: React.ReactNode;
  readonly cancelLabel?: string;
  readonly children: React.ReactNode;
};

/** An application-owned shadcn/Base UI alert-dialog recipe with focus and dismissal mechanics. */
function AlertDialog({
  open,
  onOpenChange,
  title,
  description,
  icon,
  cancelLabel = "Cancel",
  children,
}: AlertDialogProps) {
  return (
    <AlertDialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <AlertDialogPrimitive.Portal>
        <AlertDialogPrimitive.Backdrop className="dialog-backdrop" />
        <AlertDialogPrimitive.Viewport className="dialog-viewport">
          <AlertDialogPrimitive.Popup className="delete-dialog">
            {icon}
            <AlertDialogPrimitive.Title>{title}</AlertDialogPrimitive.Title>
            <AlertDialogPrimitive.Description>{description}</AlertDialogPrimitive.Description>
            <footer>
              <AlertDialogPrimitive.Close render={<Button variant="outline" size="sm" />}>
                {cancelLabel}
              </AlertDialogPrimitive.Close>
              {children}
            </footer>
          </AlertDialogPrimitive.Popup>
        </AlertDialogPrimitive.Viewport>
      </AlertDialogPrimitive.Portal>
    </AlertDialogPrimitive.Root>
  );
}

export { AlertDialog };
