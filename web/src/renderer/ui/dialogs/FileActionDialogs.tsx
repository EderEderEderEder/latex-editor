// Die Dialoge der Datei-Aktionen (W2-9), gespeist aus `app/projectFileActionsPrompts.ts`. Die Namenseingabe kann offen
// bleiben, während darüber die Rückfrage zu den Verweisen steht. Leert außerdem das App-Rückgängig beim Projektwechsel.
import { useEffect } from 'react';
import { useStore } from 'zustand';
import { fileActionPrompts } from '../../app/projectFileActionsPrompts';
import type { ConfirmQuestion } from '../../app/projectFileActionsPrompts';
import { connectAppUndoToProject } from '../../app/projectFileActionsRuntime';
import { ConfirmDeleteDialog } from './ConfirmDeleteDialog';
import { MoveDialog } from './MoveDialog';
import { NameDialog } from './NameDialog';
import { ReferenceUpdateDialog } from './ReferenceUpdateDialog';

function ConfirmDialog({ open }: { readonly open: ConfirmQuestion }) {
    switch (open.kind) {
        case 'trash':
            return <ConfirmDeleteDialog question={open.question} onAnswer={fileActionPrompts.answerTrash} />;
        case 'references':
            return <ReferenceUpdateDialog question={open.question} onAnswer={fileActionPrompts.answerReferences} />;
        case 'move':
            return <MoveDialog question={open.question} onAnswer={fileActionPrompts.answerMove} />;
    }
}

export function FileActionDialogs() {
    const name = useStore(fileActionPrompts.store, (state) => state.name);
    const confirm = useStore(fileActionPrompts.store, (state) => state.confirm);
    useEffect(() => connectAppUndoToProject(), []);
    return (
        <>
            {name !== null && <NameDialog key={name.title + name.initialName} question={name} onClose={fileActionPrompts.closeName} />}
            {confirm !== null && <ConfirmDialog open={confirm} />}
        </>
    );
}
