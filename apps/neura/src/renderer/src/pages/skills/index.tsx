/**
 * Copyright (c) 2025 Neura.
 * SPDX-License-Identifier: Apache-2.0
 */
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import {
  BookOpen,
  CheckCircle2,
  Play,
  Plus,
  RefreshCcw,
  Save,
  Search,
  Trash2,
} from 'lucide-react';
import type { SkillDefinition, SkillMetadata } from '@agent-infra/shared';

import { api } from '@renderer/api';
import { Button } from '@renderer/components/ui/button';
import { Input } from '@renderer/components/ui/input';
import { Label } from '@renderer/components/ui/label';
import { Textarea } from '@renderer/components/ui/textarea';
import { useSetting } from '@renderer/hooks/useSetting';

const emptySkill: SkillDefinition = {
  name: '',
  description: '',
  instructions: '',
  tools: [],
  chains: [],
  examples: [],
  tags: [],
  version: '1.0.0',
  author: 'Neura',
};

export default function Skills() {
  const navigate = useNavigate();
  const { settings, updateSetting } = useSetting();
  const [skills, setSkills] = useState<SkillMetadata[]>([]);
  const [selected, setSelected] = useState<SkillDefinition | null>(null);
  const [draft, setDraft] = useState<SkillDefinition>(emptySkill);
  const [query, setQuery] = useState('');
  const [runGoal, setRunGoal] = useState('');
  const [saving, setSaving] = useState(false);

  const loadSkills = async () => {
    const items = await api.listSkills();
    setSkills(items);
    if (!selected && items[0]) {
      const first = await api.getSkill({ name: items[0].name });
      setSelected(first);
      setDraft(first || emptySkill);
    }
  };

  useEffect(() => {
    void loadSkills();
  }, []);

  const filteredSkills = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (!term) {
      return skills;
    }
    return skills.filter((skill) =>
      [skill.name, skill.description, ...(skill.tags || [])]
        .join(' ')
        .toLowerCase()
        .includes(term),
    );
  }, [query, skills]);

  const selectSkill = async (name: string) => {
    const skill = await api.getSkill({ name });
    setSelected(skill);
    setDraft(skill || emptySkill);
  };

  const saveDraft = async () => {
    setSaving(true);
    try {
      const saved = await api.saveSkill({
        ...draft,
        updatedAt: Date.now(),
      });
      await loadSkills();
      await selectSkill(saved.name);
    } finally {
      setSaving(false);
    }
  };

  const deleteSelected = async () => {
    if (!selected) {
      return;
    }
    await api.deleteSkill({ name: selected.name });
    setSelected(null);
    setDraft(emptySkill);
    await loadSkills();
  };

  const useInChat = async () => {
    if (!selected) {
      return;
    }
    await updateSetting({
      ...settings,
      selectedSkillName: selected.name,
    });
    await navigate('/');
  };

  const executeSkill = async () => {
    if (!selected) {
      return;
    }
    await api.executeSkill({
      name: selected.name,
      goal: runGoal || `Use ${selected.name} skill`,
      arguments: {
        query: runGoal,
      },
    });
  };

  return (
    <div className="h-full overflow-hidden bg-[#050505] text-white">
      <div className="mx-auto grid h-full max-w-7xl grid-cols-[320px_1fr] gap-0">
        <aside className="border-r border-white/10 p-5">
          <div className="mb-4 flex items-center justify-between gap-2">
            <div>
              <h1 className="text-xl font-semibold">Skills</h1>
              <p className="mt-1 text-xs text-muted-foreground">
                Reusable, chainable Neura workflows.
              </p>
            </div>
            <Button
              size="icon"
              variant="outline"
              className="h-8 w-8"
              onClick={() => void loadSkills()}
            >
              <RefreshCcw className="h-4 w-4" />
            </Button>
          </div>
          <div className="relative mb-4">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              className="pl-9"
              value={query}
              placeholder="Search skills"
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>
          <div className="space-y-2 overflow-y-auto pr-1">
            {filteredSkills.map((skill) => (
              <button
                key={skill.name}
                type="button"
                className={`w-full rounded-lg border p-3 text-left transition ${
                  selected?.name === skill.name
                    ? 'border-blue-400/40 bg-blue-400/10'
                    : 'border-white/10 bg-white/[0.04] hover:bg-white/[0.07]'
                }`}
                onClick={() => void selectSkill(skill.name)}
              >
                <div className="flex items-center gap-2 text-sm font-medium">
                  <BookOpen className="h-4 w-4 text-blue-200" />
                  {skill.name}
                </div>
                <div className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                  {skill.description}
                </div>
                <div className="mt-2 flex flex-wrap gap-1">
                  {(skill.tags || []).slice(0, 3).map((tag) => (
                    <span
                      key={tag}
                      className="rounded-full bg-white/10 px-2 py-0.5 text-[10px] text-muted-foreground"
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              </button>
            ))}
          </div>
        </aside>
        <main className="overflow-y-auto p-6">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold">
                {selected ? selected.name : 'Create Skill'}
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Preview, edit, run, or pin a skill into chat.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                onClick={() => {
                  setSelected(null);
                  setDraft(emptySkill);
                }}
              >
                <Plus className="h-4 w-4" />
                New
              </Button>
              <Button
                variant="outline"
                disabled={!selected}
                onClick={useInChat}
              >
                <CheckCircle2 className="h-4 w-4" />
                Use in chat
              </Button>
              <Button
                variant="outline"
                disabled={!selected}
                onClick={executeSkill}
              >
                <Play className="h-4 w-4" />
                Run
              </Button>
              <Button onClick={saveDraft} disabled={saving}>
                <Save className="h-4 w-4" />
                Save
              </Button>
              <Button
                variant="outline"
                disabled={!selected}
                onClick={deleteSelected}
              >
                <Trash2 className="h-4 w-4" />
                Delete
              </Button>
            </div>
          </div>

          <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
            <section className="space-y-4 rounded-lg border border-white/10 bg-white/[0.045] p-4">
              <div className="grid gap-3 md:grid-cols-2">
                <div className="space-y-2">
                  <Label>Name</Label>
                  <Input
                    value={draft.name}
                    placeholder="market-research"
                    onChange={(event) =>
                      setDraft({ ...draft, name: event.target.value })
                    }
                  />
                </div>
                <div className="space-y-2">
                  <Label>Tags</Label>
                  <Input
                    value={(draft.tags || []).join(', ')}
                    placeholder="research, web, report"
                    onChange={(event) =>
                      setDraft({
                        ...draft,
                        tags: event.target.value
                          .split(',')
                          .map((item) => item.trim())
                          .filter(Boolean),
                      })
                    }
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label>Description</Label>
                <Input
                  value={draft.description}
                  placeholder="Conduct deep market research..."
                  onChange={(event) =>
                    setDraft({ ...draft, description: event.target.value })
                  }
                />
              </div>
              <div className="space-y-2">
                <Label>Tools</Label>
                <Input
                  value={(draft.tools || [])
                    .map((tool) =>
                      typeof tool === 'string'
                        ? tool
                        : `${tool.serverName ? `${tool.serverName}.` : ''}${tool.name}`,
                    )
                    .join(', ')}
                  placeholder="search, browser, filesystem"
                  onChange={(event) =>
                    setDraft({
                      ...draft,
                      tools: event.target.value
                        .split(',')
                        .map((item) => item.trim())
                        .filter(Boolean),
                    })
                  }
                />
              </div>
              <div className="space-y-2">
                <Label>Instructions</Label>
                <Textarea
                  className="min-h-[380px] font-mono text-xs leading-5"
                  value={draft.instructions}
                  placeholder="Step-by-step skill instructions..."
                  onChange={(event) =>
                    setDraft({ ...draft, instructions: event.target.value })
                  }
                />
              </div>
            </section>
            <aside className="space-y-4">
              <section className="rounded-lg border border-white/10 bg-white/[0.045] p-4">
                <h3 className="text-sm font-semibold">Run Skill</h3>
                <Textarea
                  className="mt-3 min-h-[120px]"
                  value={runGoal}
                  placeholder="Electric vehicles in India"
                  onChange={(event) => setRunGoal(event.target.value)}
                />
                <Button
                  className="mt-3 w-full"
                  disabled={!selected}
                  onClick={executeSkill}
                >
                  <Play className="h-4 w-4" />
                  Execute with current goal
                </Button>
              </section>
              <section className="rounded-lg border border-white/10 bg-white/[0.045] p-4">
                <h3 className="text-sm font-semibold">Examples</h3>
                <div className="mt-3 space-y-2">
                  {(draft.examples || []).length ? (
                    draft.examples?.map((example, index) => (
                      <div
                        key={`${example.input}-${index}`}
                        className="rounded-md border border-white/10 bg-black/20 p-3 text-xs"
                      >
                        <div className="text-white">{example.input}</div>
                        {example.output && (
                          <div className="mt-2 line-clamp-4 text-muted-foreground">
                            {example.output}
                          </div>
                        )}
                      </div>
                    ))
                  ) : (
                    <div className="text-sm text-muted-foreground">
                      No examples yet.
                    </div>
                  )}
                </div>
              </section>
            </aside>
          </div>
        </main>
      </div>
    </div>
  );
}
