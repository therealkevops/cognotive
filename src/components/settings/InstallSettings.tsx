"use client";

import { Check } from "lucide-react";
import { isIOS, useInstall } from "@/lib/install";
import { Group, Row, SectionHeader } from "./parts";


/* Installing k-note as an app. */

export function InstallSection() {
  const { state, install } = useInstall();
  return (
    <section aria-label="Install app">
      <SectionHeader
        title="Install app"
        description="Install k-note to open it in its own window, from your dock, taskbar, Start menu or home screen. It works offline too."
      />
      <Group>
        {state === "installed" ? (
          <Row label="Installed" description="You're using k-note as an app." >
            <span className="flex text-sm text-muted sm:justify-end">
              <Check size={16} aria-hidden className="mr-1.5 text-accent" /> Installed
            </span>
          </Row>
        ) : state === "available" ? (
          <Row label="Install k-note" description="Adds it as an app on this device.">
            <div className="flex sm:justify-end">
              <button type="button" className="button-primary" onClick={() => void install()}>
                Install
              </button>
            </div>
          </Row>
        ) : isIOS() ? (
          <Row label="On iPhone and iPad" description="In Safari, tap the Share button, then “Add to Home Screen”." stack>
            <span />
          </Row>
        ) : (
          <Row
            label="From your browser's menu"
            description="Chrome and Edge: the install icon in the address bar, or the menu's “Install k-note”. Safari on a Mac: File → Add to Dock. Firefox doesn't install web apps on desktop."
            stack
          >
            <span />
          </Row>
        )}
      </Group>
      <Group title="Shortcuts">
        <p className="py-2 text-[0.8125rem] leading-snug text-muted">
          Once installed, right-click the app&apos;s icon (or long-press it on Android) for quick actions:{" "}
          <strong className="font-medium text-foreground">New note</strong>,{" "}
          <strong className="font-medium text-foreground">Today&apos;s note</strong>,{" "}
          <strong className="font-medium text-foreground">Search notes</strong> and{" "}
          <strong className="font-medium text-foreground">New canvas</strong>.
        </p>
      </Group>
    </section>
  );
}
