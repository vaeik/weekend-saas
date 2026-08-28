import { useState } from "react";
import type { Key } from "react";
import {
  Button,
  ButtonGroup,
  Content,
  Dialog,
  Divider,
  Form,
  Heading,
  Picker,
  PickerItem,
  Switch,
  TextField,
} from "@react-spectrum/s2";

import type { ItemDraft } from "#web/lib/types.ts";
import { URL_TYPE } from "#web/lib/types.ts";

interface ItemDialogProps {
  initial: ItemDraft;
  titleText: string;
  isSaving: boolean;
  onSave: (draft: ItemDraft) => void;
  onCancel: () => void;
}

/** Add / edit form for a single menu item. */
export function ItemDialog({ initial, titleText, isSaving, onSave, onCancel }: ItemDialogProps) {
  const [draft, setDraft] = useState<ItemDraft>(initial);
  const set = <K extends keyof ItemDraft>(key: K, value: ItemDraft[K]) =>
    setDraft((d) => ({ ...d, [key]: value }));

  const titleInvalid = draft.title.trim().length === 0;
  const targetInvalid =
    (draft.urlType === URL_TYPE.LINK && draft.url.trim().length === 0) ||
    (draft.urlType === URL_TYPE.CATEGORY && draft.categoryId == null) ||
    (draft.urlType === URL_TYPE.CMS_PAGE && draft.cmsPageId == null);

  const submit = () => {
    if (titleInvalid || targetInvalid) return;
    onSave(draft);
  };

  const parseIntOrNull = (v: string): number | null => {
    const n = parseInt(v, 10);
    return Number.isInteger(n) ? n : null;
  };

  return (
    <Dialog>
      <Heading>{titleText}</Heading>
      <Divider />
      <Content>
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
      </Content>
      <ButtonGroup>
        <Button variant="secondary" onPress={onCancel} isDisabled={isSaving}>
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
    </Dialog>
  );
}
