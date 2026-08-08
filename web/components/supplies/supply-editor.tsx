"use client";

import { Button, Modal } from "@heroui/react";
import { useRouter } from "next/navigation";
import { useActionState, useEffect, useState } from "react";
import { LuPencil } from "react-icons/lu";

import {
  type InventoryState,
  saveSupplyAction,
} from "@/actions/inventory.action";
import type { SupplyItem } from "@/lib/inventory";

import { SupplyForm } from "./supply-form";

const initialState: InventoryState = { error: null };

/**
 * The Edit button on a supply's own page.
 *
 * It opens the same form the tab uses, in place. It used to link to
 * `/supplies?edit=<id>`, which did open the form — on the list page, having
 * thrown away the page you were reading. Editing something should leave you
 * looking at it.
 */
export function SupplyEditor({
  supply,
  currency,
}: {
  supply: SupplyItem;
  currency: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState(
    saveSupplyAction,
    initialState,
  );

  useEffect(() => {
    if (state.success) {
      setOpen(false);
      router.refresh();
    }
  }, [state, router]);

  return (
    <>
      <Button size="sm" variant="secondary" onPress={() => setOpen(true)}>
        <LuPencil className="size-3.5" />
        Edit
      </Button>

      <Modal.Backdrop isOpen={open} onOpenChange={setOpen}>
        <Modal.Container>
          <Modal.Dialog className="w-full sm:max-w-[640px]">
            {open && (
              <SupplyForm
                current={supply}
                currency={currency}
                error={state.error}
                formAction={formAction}
                pending={pending}
                onCancel={() => setOpen(false)}
              />
            )}
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </>
  );
}
