"use client";

import {
  askedFields,
  MACHINE_PRESETS,
  type MachinePreset,
  presetMachine,
  presetName,
} from "@furrow/document";
import { ExternalLinkIcon } from "lucide-react";
import { useState } from "react";
import { Input } from "@/components/ui/input";
import { MachineForm } from "../machine-form";

type Start = "preset" | "scratch";

const START_LABELS: Record<Start, string> = {
  preset: "Start from a preset",
  scratch: "Start from scratch",
};

const RADIO_CARD =
  "flex cursor-pointer flex-col gap-0.5 rounded-md border p-3 text-sm shadow-xs transition-colors hover:bg-accent has-checked:border-primary has-checked:bg-accent has-checked:ring-1 has-checked:ring-primary has-focus-visible:ring-[3px] has-focus-visible:ring-ring/50";

/**
 * The New machine page (PRD-0004 M6): pick a preset, which pre-fills the form
 * (M5), or fill it in from scratch. Either way the machine is saved like any
 * other, so it's fully editable and counts towards the machine limit (M10).
 */
export function NewMachine() {
  const [start, setStart] = useState<Start>("preset");
  const [preset, setPreset] = useState<MachinePreset | null>(null);
  /** Something was typed in the form, which switching would throw away. */
  const [edited, setEdited] = useState(false);

  /** Asks before a switch that unmounts an edited form; `true` to go ahead. */
  function discardEdits(): boolean {
    if (edited && !window.confirm("Discard the values you've entered?")) return false;
    setEdited(false);
    return true;
  }

  function chooseStart(value: Start) {
    if (value !== start && discardEdits()) setStart(value);
  }

  function choosePreset(value: MachinePreset) {
    if (value.id !== preset?.id && discardEdits()) setPreset(value);
  }

  return (
    <div className="grid gap-8">
      <div role="radiogroup" aria-label="Start" className="grid gap-2 sm:grid-cols-2 lg:max-w-2xl">
        {(["preset", "scratch"] as const).map((value) => (
          <label key={value} className={RADIO_CARD}>
            <input
              type="radio"
              name="start"
              value={value}
              checked={start === value}
              onChange={() => chooseStart(value)}
              className="sr-only"
            />
            <span className="font-medium">{START_LABELS[value]}</span>
            <span className="text-muted-foreground">
              {value === "preset"
                ? "Pick your router; its documented settings are filled in for you."
                : "Type every setting yourself."}
            </span>
          </label>
        ))}
      </div>

      {start === "preset" && <PresetPicker value={preset} onChange={choosePreset} />}
      {start === "preset" && preset && <PresetDetails preset={preset} />}
      {/* Notes edits, which bubble up as input events, so switching can ask first. */}
      <div onInput={() => setEdited(true)} className="contents">
        {start === "scratch" ? (
          <MachineForm />
        ) : (
          preset && (
            // Remounted per preset: the form's fields take their values on mount.
            <MachineForm
              key={preset.id}
              values={presetMachine(preset)}
              asked={askedFields(preset)}
            />
          )
        )}
      </div>
    </div>
  );
}

/** Lower-case words to match a search against. */
function searchText(preset: MachinePreset): string {
  return `${preset.maker} ${presetName(preset)}`.toLowerCase();
}

/** The catalog grouped by maker, makers in alphabetical order. */
function groupByMaker(presets: MachinePreset[]): [string, MachinePreset[]][] {
  // Not `Map.groupBy`, which is newer than Next's default browser targets.
  const groups = new Map<string, MachinePreset[]>();
  for (const preset of presets) {
    groups.set(preset.maker, [...(groups.get(preset.maker) ?? []), preset]);
  }
  return [...groups].sort(([a], [b]) => a.localeCompare(b));
}

/** The preset catalog, grouped by maker and searchable (PRD-0004 M6). */
function PresetPicker({
  value,
  onChange,
}: {
  value: MachinePreset | null;
  onChange: (preset: MachinePreset) => void;
}) {
  const [query, setQuery] = useState("");
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const matches = MACHINE_PRESETS.filter((preset) =>
    words.every((word) => searchText(preset).includes(word)),
  );
  // The chosen preset stays listed, so the form below never belongs to a hidden one.
  const shown = MACHINE_PRESETS.filter(
    (preset) => preset.id === value?.id || matches.includes(preset),
  );

  return (
    <section aria-labelledby="presets-heading" className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h2 id="presets-heading" className="font-medium">
          Presets
        </h2>
        <Input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search machines…"
          aria-label="Search machines"
          className="max-w-xs"
        />
      </div>
      {matches.length === 0 && (
        <p className="text-muted-foreground">
          No preset matches “{query}”. Start from scratch to describe your machine yourself.
        </p>
      )}
      {shown.length > 0 && (
        <div role="radiogroup" aria-labelledby="presets-heading" className="grid gap-4">
          {groupByMaker(shown).map(([maker, presets]) => (
            <div key={maker} className="grid gap-2">
              <h3 className="text-sm text-muted-foreground">{maker}</h3>
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                {presets.map((preset) => (
                  <label key={preset.id} className={RADIO_CARD}>
                    <input
                      type="radio"
                      name="preset"
                      value={preset.id}
                      checked={value?.id === preset.id}
                      onChange={() => onChange(preset)}
                      className="sr-only"
                    />
                    <span className="font-medium">{preset.model}</span>
                    {preset.variant && (
                      <span className="text-muted-foreground">{preset.variant}</span>
                    )}
                  </label>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

/** What to know before using a preset: firmware (M7), notes (M8), what to fill in and sources. */
function PresetDetails({ preset }: { preset: MachinePreset }) {
  return (
    <section
      aria-labelledby="preset-heading"
      className="grid gap-4 rounded-lg border p-4 text-sm lg:max-w-3xl"
    >
      <h2 id="preset-heading" className="text-base font-medium">
        {preset.maker} {presetName(preset)}
      </h2>
      <p>
        <span className="font-medium">Firmware: </span>
        {preset.firmware}
      </p>
      {preset.notes.length > 0 && (
        <ul className="grid list-disc gap-1 pl-5">
          {preset.notes.map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
      )}
      {preset.ask.length > 0 && (
        <div className="grid gap-1">
          <p className="font-medium">You fill in</p>
          <ul className="grid list-disc gap-1 pl-5">
            {preset.ask.map((question) => (
              <li key={question.help}>{question.help}</li>
            ))}
          </ul>
        </div>
      )}
      <div className="grid gap-1">
        <p className="font-medium">Sources</p>
        <ul className="grid gap-1">
          {preset.sources.map((source) => (
            <li key={source.url}>
              <a
                href={source.url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 underline"
              >
                {source.title}
                <ExternalLinkIcon className="size-3.5" aria-hidden />
              </a>
            </li>
          ))}
        </ul>
      </div>
      <p className="text-muted-foreground">
        Check the values below against your build; you can change any of them, now or later.
      </p>
    </section>
  );
}
