import type { Key } from "react";
import {
  ActionMenu,
  Cell,
  Column,
  MenuItem as ActionMenuItem,
  Row,
  StatusLight,
  TableBody,
  TableHeader,
  TableView,
} from "@react-spectrum/s2";

import type { FlatRow } from "#web/lib/types.ts";
import { targetLabel, typeLabel } from "#web/lib/tree-util.ts";

export type RowActionKey = "edit" | "add-child" | "up" | "down" | "delete";

interface ItemGridProps {
  rows: FlatRow[];
  onRowAction: (row: FlatRow, key: RowActionKey) => void;
}

/** Flat, Magento-grid-style table of menu items. */
export function ItemGrid({ rows, onRowAction }: ItemGridProps) {
  const byId = new Map(rows.map((r) => [String(r.id), r]));

  return (
    <TableView
      aria-label="Menu items"
      selectionMode="none"
      onAction={(key: Key) => {
        const row = byId.get(String(key));
        if (row) onRowAction(row, "edit");
      }}
    >
      <TableHeader>
        <Column isRowHeader width="40%">
          Title
        </Column>
        <Column>Type</Column>
        <Column>Target</Column>
        <Column align="end">Pos</Column>
        <Column>Status</Column>
        <Column align="end">Actions</Column>
      </TableHeader>
      <TableBody>
        {rows.map((row) => (
          <Row key={String(row.id)} id={String(row.id)}>
            <Cell>
              <span style={{ paddingInlineStart: row.depth * 18 }}>
                {row.depth > 0 && <span style={{ opacity: 0.4 }}>└ </span>}
                {row.title}
              </span>
            </Cell>
            <Cell>{typeLabel(row.urlType)}</Cell>
            <Cell>{targetLabel(row)}</Cell>
            <Cell>{row.position}</Cell>
            <Cell>
              <StatusLight
                size="S"
                variant={row.isActive === false ? "neutral" : "positive"}
              >
                {row.isActive === false ? "Inactive" : "Active"}
              </StatusLight>
            </Cell>
            <Cell>
              <ActionMenu
                aria-label={`Actions for ${row.title}`}
                isQuiet
                onAction={(key: Key) => onRowAction(row, String(key) as RowActionKey)}
              >
                <ActionMenuItem id="edit">Edit</ActionMenuItem>
                <ActionMenuItem id="add-child">Add sub-item</ActionMenuItem>
                <ActionMenuItem id="up">Move up</ActionMenuItem>
                <ActionMenuItem id="down">Move down</ActionMenuItem>
                <ActionMenuItem id="delete">Delete</ActionMenuItem>
              </ActionMenu>
            </Cell>
          </Row>
        ))}
      </TableBody>
    </TableView>
  );
}
