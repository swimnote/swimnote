import { useState, useCallback } from "react";

export interface SelectionModeState {
  selectionMode: boolean;
  selectedIds: Set<string>;
  isAllSelected: (visibleIds: string[]) => boolean;
  toggleSelectionMode: () => void;
  enterSelectionMode: () => void;
  exitSelectionMode: () => void;
  toggleItem: (id: string) => void;
  selectAll: (visibleIds: string[]) => void;
  clearSelection: () => void;
  selectedCount: number;
  isSelected: (id: string) => boolean;
}

export function useSelectionMode(): SelectionModeState {
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const toggleSelectionMode = useCallback(() => {
    setSelectionMode(prev => {
      if (prev) setSelectedIds(new Set());
      return !prev;
    });
  }, []);

  const enterSelectionMode = useCallback(() => {
    setSelectionMode(true);
    setSelectedIds(new Set());
  }, []);

  const exitSelectionMode = useCallback(() => {
    setSelectionMode(false);
    setSelectedIds(new Set());
  }, []);

  const toggleItem = useCallback((id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const selectAll = useCallback((visibleIds: string[]) => {
    setSelectedIds(prev => {
      const allSelected = visibleIds.every(id => prev.has(id));
      if (allSelected) return new Set();
      return new Set(visibleIds);
    });
  }, []);

  const clearSelection = useCallback(() => {
    setSelectedIds(new Set());
  }, []);

  const isAllSelected = useCallback((visibleIds: string[]) => {
    if (visibleIds.length === 0) return false;
    return visibleIds.every(id => selectedIds.has(id));
  }, [selectedIds]);

  const isSelected = useCallback((id: string) => selectedIds.has(id), [selectedIds]);

  return {
    selectionMode,
    selectedIds,
    isAllSelected,
    toggleSelectionMode,
    enterSelectionMode,
    exitSelectionMode,
    toggleItem,
    selectAll,
    clearSelection,
    selectedCount: selectedIds.size,
    isSelected,
  };
}
