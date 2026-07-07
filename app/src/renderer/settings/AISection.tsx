import { Sparkles } from "lucide-react";
import type { ToastData } from "@sproutgit/ui";
import { AgentsSection } from "./AgentsSection.js";
import { CommitMessageGeneratorSection } from "./CommitMessageGeneratorSection.js";
import { AIProvidersSection } from "./AIProvidersSection.js";

interface Props {
  onToast: (msg: string, variant?: ToastData["variant"]) => void;
}

/** Groups the AI Agents roster and AI Commit Messages rows into one card, matching how Git Settings groups Author/Editor/Diff/Merge as rows under one heading. */
export function AISection({ onToast }: Props) {
  return (
    <section className="rounded-lg border border-(--sg-border) bg-(--sg-surface)">
      <div className="border-b border-(--sg-border) px-5 py-4">
        <h2 className="sg-heading text-sm font-semibold text-(--sg-primary) flex items-center gap-1.5">
          <Sparkles size={15} /> AI
        </h2>
        <p className="mt-1 text-xs text-(--sg-text-faint)">
          Configure the coding agents and commit message generator SproutGit
          launches for you.
        </p>
      </div>

      <div className="divide-y divide-(--sg-border)">
        <AgentsSection onToast={onToast} />
        <CommitMessageGeneratorSection onToast={onToast} />
        <AIProvidersSection onToast={onToast} />
      </div>
    </section>
  );
}
