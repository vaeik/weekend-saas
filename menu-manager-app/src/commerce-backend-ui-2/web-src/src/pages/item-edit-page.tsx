import { useState } from "react";
import type { Key } from "react";
import {
  ActionButton,
  Button,
  ButtonGroup,
  Divider,
  Form,
  Heading,
  Picker,
  PickerItem,
  Switch,
  Text,
  TextField,
} from "@react-spectrum/s2";

import type { ItemDraft } from "#web/lib/types.ts";
import { URL_TYPE } from "#web/lib/types.ts";

interface ParentOption {
  id: string;
  label: string;
}

interface ItemEditPageProps {
  draft: ItemDraft;
  heading: string;
  parentOptions: ParentOption[];
  isSaving: boolean;
  onSave: (draft: ItemDraft) => void;
  onDelete?: () => void;
  onBack: () => void;
}

const NONE = "__none__";

/** Full-page add / edit form (Magento-style edit page, not a modal). */
export function ItemEditPage({
  draft: initial,
  heading,
  parentOptions,
  isSaving,
  onSave,
  onDelete,
  onBack,
}: ItemEditPageProps) {
  const [draft, setDraft] = useState<ItemDraft>(initial);
  const set = <K extends keyof ItemDraft>(key: K, value: ItemDraft[K]) =>
    setDraft((d) => ({ ...d, [key]: value }));

  const parseIntOrNull = (v: string): number | null => {
    const n = parseInt(v, 10);
    return Number.isInteger(n) ? n : null;
  };

  const titleInvalid = draft.title.trim().length === 0;
  const targetInvalid =
    (draft.urlType === URL_TYPE.LINK && draft.url.trim().length === 0) ||
    (draft.urlType === URL_TYPE.CATEGORY && draft.categoryId == null) ||
    (draft.urlType === URL_TYPE.CMS_PAGE && draft.cmsPageId == null);

  const submit = () => {
    if (titleInvalid || targetInvalid) return;
    onSave(draft);
  };

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 8 }}>
        <ActionButton onPress={onBack} isDisabled={isSaving}>
          ← Back
        </ActionButton>
        <Heading>{heading}</Heading>
      </div>
      <Divider size="M" />

      <div style={{ marginTop: 16, maxWidth: 560 }}>
        <Form onSubmit={(e) => e.preventDefault()}>
          <TextField
            label="Title"
            value={draft.title}
            onChange={(v) => set("title", v)}
            isRequired
            isInvalid={titleInvalid}
            autoFocus
          />

          <Picker
            label="Link type"
            selectedKey={String(draft.urlType)}
            onSelectionChange={(k: Key) => set("urlType", Number(k))}
          >
            <PickerItem id={String(URL_TYPE.LINK)}>Link (URL)</PickerItem>
            <PickerItem id={String(URL_TYPE.CATEGORY)}>Category</PickerItem>
            <PickerItem id={String(URL_TYPE.CMS_PAGE)}>CMS page</PickerItem>
          </Picker>

          {draft.urlType === URL_TYPE.LINK && (
            <TextField
              label="URL"
              value={draft.url}
              onChange={(v) => set("url", v)}
              isRequired
              isInvalid={draft.url.trim().length === 0}
              description="e.g. /women or https://example.com"
            />
          )}
          {draft.urlType === URL_TYPE.CATEGORY && (
            <TextField
              label="Category ID"
              value={draft.categoryId == null ? "" : String(draft.categoryId)}
              onChange={(v) => set("categoryId", parseIntOrNull(v))}
              isRequired
              isInvalid={draft.categoryId == null}
            />
          )}
          {draft.urlType === URL_TYPE.CMS_PAGE && (
            <TextField
              label="CMS page ID"
              value={draft.cmsPageId == null ? "" : String(draft.cmsPageId)}
              onChange={(v) => set("cmsPageId", parseIntOrNull(v))}
              isRequired
              isInvalid={draft.cmsPageId == null}
            />
          )}

          <Picker
            label="Parent"
            selectedKey={draft.parentId ?? NONE}
            onSelectionChange={(k: Key) => set("parentId", k === NONE ? null : String(k))}
          >
            {[{ id: NONE, label: "— Top level —" }, ...parentOptions].map((o) => (
              <PickerItem key={o.id} id={o.id}>
                {o.label}
              </PickerItem>
            ))}
          </Picker>

          <TextField
            label="Position"
            value={String(draft.position)}
            onChange={(v) => set("position", parseInt(v, 10) || 0)}
            description="Order among siblings (0 = first)"
          />

          <TextField
            label="Identifier (optional)"
            value={draft.identifier}
            onChange={(v) => set("identifier", v)}
          />
          <TextField
            label="CSS class (optional)"
            value={draft.itemClass}
            onChange={(v) => set("itemClass", v)}
          />

          <Switch
            isSelected={draft.openType === 1}
            onChange={(sel) => set("openType", sel ? 1 : 0)}
          >
            Open in a new tab
          </Switch>
          <Switch isSelected={draft.isActive} onChange={(sel) => set("isActive", sel)}>
            Active
          </Switch>
        </Form>

        <div style={{ display: "flex", alignItems: "center", marginTop: 24 }}>
          {onDelete && (
            <Button variant="negative" onPress={onDelete} isDisabled={isSaving}>
              Delete
            </Button>
          )}
          <div style={{ flex: 1 }} />
          <ButtonGroup>
            <Button variant="secondary" onPress={onBack} isDisabled={isSaving}>
              Cancel
            </Button>
            <Button
              variant="accent"
              onPress={submit}
              isDisabled={titleInvalid || targetInvalid}
              isPending={isSaving}
            >
              Save
            </Button>
          </ButtonGroup>
        </div>
        {(titleInvalid || targetInvalid) && (
          <div style={{ marginTop: 8 }}>
            <Text>
              <span style={{ fontSize: 12, color: "var(--s2-negative, #d32029)" }}>
                Fill in the title and the required target for the selected link type.
              </span>
            </Text>
          </div>
        )}
      </div>
    </div>
  );
}
