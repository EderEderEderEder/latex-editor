// Einstellungen „Bild“ (Vorlage `ImageSettingsView`): Bild ziehen, per Dialog wählen oder aus dem Projekt nehmen. Ein
// Bild von außen wird beim Einfügen nach `images/` kopiert (`image:import`); der Pfad kommt aus `graphicsReference`.
import { useId, useState } from 'react';
import type { DragEvent } from 'react';
import { chooseImageFile, chooseProjectImage, dropImageFiles } from '../../app/insertImage';
import { IMAGES_DIRECTORY, imageReferenceOf } from '../../app/insertLogic';
import { sanitizedName } from '../../../shared/core/insertion';
import { insertDeps } from '../../app/insertRuntime';
import { insertStore, useInsertStore } from '../../stores/insert';
import { CaptionFields } from './CaptionFields';
import { SettingsCard } from './Fields';

export const IMAGE_PANEL_TEXTS = {
    card: 'Bild',
    dropTitle: 'Bild hierher ziehen',
    dropHint: 'PNG, JPG oder PDF – oder darunter ein Bild aus dem Projekt wählen.',
    choose: 'Datei wählen …',
    fromProject: 'Aus dem Projekt',
    noChoice: '—',
    width: 'Breite',
    inProject: 'Liegt im Projekt und wird nicht kopiert.',
    willCopy: (name: string) => `Wird beim Einfügen nach „${IMAGES_DIRECTORY}/“ kopiert als „${sanitizedName(name)}“.`,
    reference: (path: string) => `Im Text: ${path}`,
} as const;

const MINIMUM_WIDTH = 10;
const MAXIMUM_WIDTH = 100;
const WIDTH_STEP = 5;

function hasFiles(event: DragEvent): boolean {
    return Array.from(event.dataTransfer.types).includes('Files');
}

function DropArea() {
    const [isTargeted, setTargeted] = useState(false);
    const choice = useInsertStore((state) => state.imageChoice);
    const reference = useInsertStore((state) => imageReferenceOf(state, state.catalog));
    const onDrop = (event: DragEvent): void => {
        event.preventDefault();
        setTargeted(false);
        void dropImageFiles(insertDeps(), Array.from(event.dataTransfer.files));
    };
    return (
        <div
            className={isTargeted ? 'insert-drop is-targeted' : 'insert-drop'}
            data-testid="insert-image-drop"
            onDragOver={(event) => {
                if (!hasFiles(event)) return;
                event.preventDefault();
                setTargeted(true);
            }}
            onDragLeave={() => setTargeted(false)}
            onDrop={onDrop}
        >
            <div className="insert-drop-text">
                <strong>{choice === null ? IMAGE_PANEL_TEXTS.dropTitle : choice.name}</strong>
                <span>
                    {choice === null && IMAGE_PANEL_TEXTS.dropHint}
                    {choice?.kind === 'project' && IMAGE_PANEL_TEXTS.inProject}
                    {choice?.kind === 'external' && IMAGE_PANEL_TEXTS.willCopy(choice.name)}
                </span>
                {choice !== null && <code>{IMAGE_PANEL_TEXTS.reference(reference)}</code>}
                <div>
                    <button type="button" onClick={() => void chooseImageFile(insertDeps())}>{IMAGE_PANEL_TEXTS.choose}</button>
                </div>
            </div>
        </div>
    );
}

function ProjectImageSelect() {
    const id = useId();
    const images = useInsertStore((state) => state.catalog.images);
    const choice = useInsertStore((state) => state.imageChoice);
    const value = choice?.kind === 'project' ? choice.path : '';
    return (
        <div className="insert-row">
            <label htmlFor={id}>{IMAGE_PANEL_TEXTS.fromProject}</label>
            <select id={id} value={value} onChange={(event) => chooseProjectImage(insertDeps(), event.target.value)}>
                <option value="">{IMAGE_PANEL_TEXTS.noChoice}</option>
                {images.map((image) => <option key={image.path} value={image.path}>{image.relative}</option>)}
            </select>
        </div>
    );
}

function WidthSlider() {
    const id = useId();
    const percent = useInsertStore((state) => state.image.widthPercent);
    return (
        <div className="insert-row">
            <label htmlFor={id}>{IMAGE_PANEL_TEXTS.width}</label>
            <div className="insert-slider">
                <input
                    id={id}
                    type="range"
                    min={MINIMUM_WIDTH}
                    max={MAXIMUM_WIDTH}
                    step={WIDTH_STEP}
                    value={percent}
                    onChange={(event) => insertStore.getState().update('image', (image) => ({ ...image, widthPercent: event.target.valueAsNumber }))}
                />
                <output htmlFor={id}>{percent} %</output>
            </div>
        </div>
    );
}

export function ImagePanel() {
    return (
        <>
            <SettingsCard title={IMAGE_PANEL_TEXTS.card}>
                <DropArea />
                <ProjectImageSelect />
                <WidthSlider />
            </SettingsCard>
            <CaptionFields kind="image" showsEscape />
        </>
    );
}
