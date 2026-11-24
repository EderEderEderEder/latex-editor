// Tab-Leiste (W2-4, ersetzt `EditorTabs`): Vorschau-Tab kursiv, aktiver Tab, Punkt für „ungespeichert“, Schließen-Knopf,
// Mittelklick schließt, Doppelklick macht fest, Reihenfolge per Ziehen (HTML5 Drag & Drop) und Pfeiltasten, Überlauf
// scrollt waagerecht und hält den aktiven Tab sichtbar. Schließen mit Änderungen fragt nach (`TabCloseDialog`).
import { useEffect, useMemo, useRef, useState } from 'react';
import type { DragEvent, KeyboardEvent, MouseEvent, RefObject } from 'react';
import { closeTabWithPrompt } from '../app/tabClose';
import type { TabCloseDeps } from '../app/tabClose';
import { tabClosePrompt } from '../app/tabClosePrompt';
import {
    TAB_DIRTY_LABEL, buildTabBarItems, isTabNavigationKey, scrollLeftToReveal, tabAfterKey,
} from '../app/tabBarData';
import type { TabBarItem } from '../app/tabBarData';
import { getApi } from '../ipc/api';
import { editorStore, useEditorStore } from '../stores/editor';
import { statusStore } from '../stores/status';
import { TabCloseDialog } from './TabCloseDialog';

const TAB_DRAG_TYPE = 'application/x-latexeditor-tab';
const MIDDLE_BUTTON = 1;

function closeDeps(): TabCloseDeps {
    return {
        api: getApi(),
        store: editorStore,
        report: (message) => statusStore.getState().show(message),
        ask: (name) => tabClosePrompt.ask(name),
    };
}

function requestClose(path: string): void {
    void closeTabWithPrompt(closeDeps(), path);
}

/** Hält den aktiven Tab im sichtbaren Teil der Leiste */
function useRevealActiveTab(listRef: RefObject<HTMLDivElement | null>, active: string | null): void {
    useEffect(() => {
        const list = listRef.current;
        if (list === null || active === null) return;
        const element = Array.from(list.children).find((child) => (child as HTMLElement).dataset.tabPath === active);
        if (!(element instanceof HTMLElement)) return;
        const view = { start: list.scrollLeft, size: list.clientWidth };
        list.scrollLeft = scrollLeftToReveal(view, { start: element.offsetLeft, size: element.offsetWidth });
    }, [listRef, active]);
}

interface TabDrag {
    readonly dragged: string | null;
    readonly target: string | null;
    handlersFor(path: string): {
        onDragStart(event: DragEvent): void;
        onDragOver(event: DragEvent): void;
        onDragLeave(event: DragEvent): void;
        onDrop(event: DragEvent): void;
        onDragEnd(): void;
    };
    dropAtEnd(lastPath: string | undefined): { onDragOver(event: DragEvent): void; onDrop(event: DragEvent): void };
}

function useTabDrag(): TabDrag {
    const [dragged, setDragged] = useState<string | null>(null);
    const [target, setTarget] = useState<string | null>(null);
    const reset = (): void => {
        setDragged(null);
        setTarget(null);
    };
    const accept = (event: DragEvent): boolean => {
        if (dragged === null) return false;
        event.preventDefault();
        event.dataTransfer.dropEffect = 'move';
        return true;
    };
    const dropOnto = (event: DragEvent, onto: string | undefined): void => {
        event.preventDefault();
        if (dragged !== null && onto !== undefined) editorStore.getState().move(dragged, onto);
        reset();
    };
    return {
        dragged,
        target,
        handlersFor: (path) => ({
            onDragStart: (event) => {
                event.dataTransfer.effectAllowed = 'move';
                event.dataTransfer.setData(TAB_DRAG_TYPE, path);
                setDragged(path);
            },
            onDragOver: (event) => {
                if (accept(event) && dragged !== path) setTarget(path);
            },
            onDragLeave: (event) => {
                if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setTarget((current) => (current === path ? null : current));
            },
            onDrop: (event) => dropOnto(event, path),
            onDragEnd: reset,
        }),
        dropAtEnd: (lastPath) => ({
            onDragOver: (event) => {
                if (event.target === event.currentTarget) accept(event);
            },
            onDrop: (event) => {
                if (event.target === event.currentTarget) dropOnto(event, lastPath);
            },
        }),
    };
}

function tabClassName(item: TabBarItem, isDropTarget: boolean, isDragged: boolean): string {
    return ['editor-tab', item.isActive && 'is-active', isDropTarget && 'is-drop-target', isDragged && 'is-dragging']
        .filter(Boolean)
        .join(' ');
}

interface TabViewProps {
    readonly item: TabBarItem;
    readonly drag: TabDrag;
    readonly onKeyDown: (event: KeyboardEvent<HTMLButtonElement>, item: TabBarItem) => void;
}

function TabView({ item, drag, onKeyDown }: TabViewProps) {
    // Mittelklick auf der Maus: kein Autoscroll-Kreuz (Windows), das Schließen kommt über `auxclick`.
    const preventAutoscroll = (event: MouseEvent): void => {
        if (event.button === MIDDLE_BUTTON) event.preventDefault();
    };
    const closeByMiddleClick = (event: MouseEvent): void => {
        if (event.button !== MIDDLE_BUTTON) return;
        event.preventDefault();
        requestClose(item.path);
    };
    return (
        <div
            role="presentation"
            className={tabClassName(item, drag.target === item.path, drag.dragged === item.path)}
            data-tab-path={item.path}
            draggable
            onMouseDown={preventAutoscroll}
            onAuxClick={closeByMiddleClick}
            {...drag.handlersFor(item.path)}
        >
            <button
                type="button"
                role="tab"
                aria-selected={item.isActive}
                tabIndex={item.isActive ? 0 : -1}
                className={item.isPreview ? 'editor-tab-title is-preview' : 'editor-tab-title'}
                title={item.hint}
                onClick={() => editorStore.getState().activate(item.path)}
                onDoubleClick={() => editorStore.getState().pin(item.path)}
                onKeyDown={(event) => onKeyDown(event, item)}
            >
                {item.title}
            </button>
            {item.isDirty && <span className="tab-dirty" role="img" aria-label={TAB_DIRTY_LABEL} />}
            <button type="button" tabIndex={-1} className="editor-tab-close" aria-label={item.closeLabel} onClick={() => requestClose(item.path)}>
                ×
            </button>
        </div>
    );
}

export function TabBar() {
    const tabs = useEditorStore((state) => state.tabs);
    const files = useEditorStore((state) => state.files);
    const items = useMemo(() => buildTabBarItems(tabs, files), [tabs, files]);
    const listRef = useRef<HTMLDivElement>(null);
    const drag = useTabDrag();
    useRevealActiveTab(listRef, tabs.active);

    // Pfeile, Pos1 und Ende wechseln den Tab und nehmen den Fokus mit
    const navigate = (event: KeyboardEvent<HTMLButtonElement>, item: TabBarItem): void => {
        if (!isTabNavigationKey(event.key)) return;
        const next = tabAfterKey(items, item.path, event.key);
        if (next === null) return;
        event.preventDefault();
        editorStore.getState().activate(next);
        const element = Array.from(listRef.current?.children ?? []).find((child) => (child as HTMLElement).dataset.tabPath === next);
        element?.querySelector<HTMLElement>('[role="tab"]')?.focus();
    };

    return (
        <>
            <div ref={listRef} className="editor-tabs" role="tablist" aria-label="Geöffnete Dateien" {...drag.dropAtEnd(items.at(-1)?.path)}>
                {items.map((item) => (
                    <TabView key={item.path} item={item} drag={drag} onKeyDown={navigate} />
                ))}
            </div>
            <TabCloseDialog />
        </>
    );
}
