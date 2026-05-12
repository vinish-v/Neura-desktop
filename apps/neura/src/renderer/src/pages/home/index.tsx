/**
 * Copyright (c) 2025 Neura.
 * SPDX-License-Identifier: Apache-2.0
 */
import { useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import {
  Code2,
  FileText,
  FolderOpen,
  Globe2,
  Image,
  Loader2,
  Plus,
  Search,
  Send,
  Sparkles,
  X,
} from 'lucide-react';
import { motion } from 'framer-motion';

import { Button } from '@renderer/components/ui/button';
import { Textarea } from '@renderer/components/ui/textarea';
import { toast } from 'sonner';

import { useSession } from '../../hooks/useSession';
import { classifyInteractionForInstructions } from '../../utils/operatorRouting';

import { DragArea } from '../../components/Common/drag';
import { useSetting } from '@renderer/hooks/useSetting';
import { TaskRunRecord } from '@main/store/types';

type LocalAttachment = File & { path?: string };

const formatBytes = (size: number) => {
  if (size < 1024) {
    return `${size} B`;
  }
  if (size < 1024 * 1024) {
    return `${Math.round(size / 1024)} KB`;
  }
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
};

const attachmentSummary = (attachments: LocalAttachment[]) =>
  attachments
    .map((file) => {
      const location = file.path ? `, path: ${file.path}` : '';
      return `- ${file.name} (${file.type || 'file'}, ${formatBytes(file.size)}${location})`;
    })
    .join('\n');

const quickActions = [
  {
    title: 'Build Website',
    prompt: 'Build a modern SaaS landing page for AI tools.',
    icon: Globe2,
  },
  {
    title: 'Deep Research',
    prompt: '/multi-agent Research the market for electric vehicles in India.',
    icon: Search,
  },
  {
    title: 'Organize Files',
    prompt: 'Organize files in my Downloads folder by type and date.',
    icon: FolderOpen,
  },
  {
    title: 'Code Project',
    prompt:
      'Inspect this project and suggest the next high-impact improvements.',
    icon: Code2,
  },
  {
    title: 'Use Skill',
    prompt: 'Use market-research skill for AI desktop agents.',
    icon: Sparkles,
  },
];

const Home = () => {
  const navigate = useNavigate();
  const { createSession } = useSession();
  const { settings } = useSetting();
  const [prompt, setPrompt] = useState('');
  const [attachments, setAttachments] = useState<LocalAttachment[]>([]);
  const [starting, setStarting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const startUnifiedNeura = async (overridePrompt?: string) => {
    const rawPrompt = (overridePrompt || prompt).trim();
    const attachmentText = attachmentSummary(attachments);
    const instructions = attachmentText
      ? `${rawPrompt || 'Uploaded files'}\n\nAttached files:\n${attachmentText}`
      : rawPrompt;

    if (!instructions || starting) {
      return;
    }

    try {
      setStarting(true);
      const route = classifyInteractionForInstructions(instructions);
      const operator = route.operator;
      const session = await createSession(instructions, {
        operator,
      });

      if (!session?.id) {
        toast.error('Could not create a task session. Please try again.');
        return;
      }

      navigate('/local', {
        state: {
          operator,
          sessionId: session.id,
          from: 'home',
          initialPrompt: instructions,
          initialMode: route.mode,
        },
      });
    } catch (error) {
      console.error('startUnifiedNeura', error);
      toast.error('Could not start the task. Please try again.');
    } finally {
      setStarting(false);
    }
  };

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || []) as LocalAttachment[];
    if (!files.length) {
      return;
    }

    setAttachments((current) => [...current, ...files]);
    event.target.value = '';
  };

  const removeAttachment = (index: number) => {
    setAttachments((current) => current.filter((_, idx) => idx !== index));
  };

  const hasInput = !!prompt.trim() || attachments.length > 0;
  const runs = ([...(settings.taskRuns || [])] as TaskRunRecord[]).sort(
    (a, b) => b.startedAt - a.startedAt,
  );
  const activeRuns = runs.filter((run) => run.status === 'running').slice(0, 3);
  const recentRuns = runs.filter((run) => run.status !== 'running').slice(0, 5);

  return (
    <div className="relative h-full w-full overflow-y-auto bg-[#0a0a0a]">
      <DragArea></DragArea>
      <div className="mx-auto flex min-h-full w-full max-w-6xl flex-col px-8 py-12">
        <section className="flex flex-1 flex-col items-center justify-center py-8">
          <div className="mb-8 text-center">
            <h1 className="text-[34px] font-semibold leading-tight tracking-normal text-white">
              What would you like to do today?
            </h1>
            <p className="mt-3 text-sm leading-6 text-[#a3a3a3]">
              Research, build, automate, organize, and ship with Neura.
            </p>
          </div>

          <div className="w-full max-w-3xl rounded-xl border border-[#2a2a2a] bg-[#171717]">
            <div className="relative min-h-[156px]">
              <input
                ref={fileInputRef}
                type="file"
                className="hidden"
                multiple
                accept="image/*,.pdf,.txt,.md,.csv,.json,.doc,.docx,.xls,.xlsx,.ppt,.pptx"
                onChange={handleFileChange}
              />
              <Textarea
                value={prompt}
                onChange={(event) => setPrompt(event.target.value)}
                onKeyDown={(event) => {
                  if (
                    event.key === 'Enter' &&
                    !event.shiftKey &&
                    !event.nativeEvent.isComposing
                  ) {
                    event.preventDefault();
                    startUnifiedNeura();
                  }
                }}
                placeholder="Ask Neura to build, research, automate, or organize..."
                className="min-h-[154px] resize-none border-0 bg-transparent px-6 py-5 pb-16 pr-16 text-base leading-7 text-white shadow-none placeholder:text-[#666] focus-visible:ring-0"
              />
              {attachments.length > 0 && (
                <div className="absolute bottom-16 left-6 right-6 flex flex-wrap gap-2">
                  {attachments.map((file, index) => {
                    const AttachmentIcon = file.type?.startsWith('image/')
                      ? Image
                      : FileText;

                    return (
                      <div
                        key={`${file.name}-${file.size}-${index}`}
                        className="flex max-w-[220px] items-center gap-2 rounded-md border border-[#2a2a2a] bg-[#1a1a1a] px-3 py-1 text-xs text-white"
                        title={file.path || file.name}
                      >
                        <AttachmentIcon className="h-3.5 w-3.5 shrink-0" />
                        <span className="truncate">{file.name}</span>
                        <span className="shrink-0 text-muted-foreground">
                          {formatBytes(file.size)}
                        </span>
                        <button
                          type="button"
                          className="ml-1 rounded-full text-muted-foreground hover:text-foreground"
                          onClick={() => removeAttachment(index)}
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
              <motion.div
                whileHover={{ scale: 1.04 }}
                whileTap={{ scale: 0.97 }}
                className="absolute bottom-5 left-5"
              >
                <Button
                  type="button"
                  variant="secondary"
                  size="icon"
                  aria-label="Upload photos or files"
                  className="size-9 rounded-lg border border-[#2a2a2a] bg-[#1a1a1a] text-white hover:bg-[#252526]"
                  disabled={starting}
                  onClick={() => fileInputRef.current?.click()}
                  title="Upload photos or files"
                >
                  <Plus className="size-5 stroke-[2.5]" />
                </Button>
              </motion.div>
              <motion.div
                whileHover={{ scale: hasInput ? 1.04 : 1 }}
                whileTap={{ scale: hasInput ? 0.97 : 1 }}
                className="absolute bottom-5 right-5"
              >
                <Button
                  variant="secondary"
                  size="icon"
                  className="size-9 rounded-lg bg-blue-500 text-white hover:bg-blue-400 disabled:bg-white/10 disabled:text-white/35"
                  disabled={!hasInput || starting}
                  onClick={() => startUnifiedNeura()}
                >
                  {starting ? (
                    <Loader2 className="size-5 animate-spin" />
                  ) : (
                    <Send className="size-5" />
                  )}
                </Button>
              </motion.div>
            </div>
          </div>

          <div className="mt-5 grid w-full max-w-3xl grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-5">
            {quickActions.map((action) => {
              const Icon = action.icon;
              return (
                <button
                  key={action.title}
                  type="button"
                  className="neura-panel neura-panel-hover flex items-center gap-2 rounded-lg px-3 py-3 text-left text-sm text-white"
                  onClick={() => setPrompt(action.prompt)}
                >
                  <Icon className="h-4 w-4 shrink-0 text-blue-300" />
                  <span className="truncate">{action.title}</span>
                </button>
              );
            })}
          </div>
        </section>

        <section className="grid gap-4 pb-8 lg:grid-cols-2">
          <div className="neura-panel rounded-lg p-4">
            <h2 className="mb-3 text-sm font-semibold text-white">
              Active Tasks
            </h2>
            {activeRuns.length ? (
              <div className="space-y-2">
                {activeRuns.map((run) => (
                  <div
                    key={run.runId}
                    className="rounded-md border border-[#2a2a2a] bg-[#0f0f0f] p-3"
                  >
                    <div className="truncate text-sm text-white">
                      {run.originalGoal}
                    </div>
                    <div className="mt-2 h-1.5 rounded-full bg-white/10">
                      <div className="h-full w-1/2 rounded-full bg-blue-400" />
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                No active tasks right now.
              </p>
            )}
          </div>

          <div className="neura-panel rounded-lg p-4">
            <h2 className="mb-3 text-sm font-semibold text-white">
              Recent Activity
            </h2>
            {recentRuns.length ? (
              <div className="space-y-2">
                {recentRuns.map((run) => (
                  <div
                    key={run.runId}
                    className="flex items-center justify-between gap-3 rounded-md border border-[#2a2a2a] bg-[#0f0f0f] p-3"
                  >
                    <div className="min-w-0">
                      <div className="truncate text-sm text-white">
                        {run.originalGoal}
                      </div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        {run.runMode.replace(/_/g, ' ')}
                      </div>
                    </div>
                    <span className="rounded-full border border-[#2a2a2a] px-2 py-1 text-[11px] text-muted-foreground">
                      {run.status}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                Finished tasks will appear here.
              </p>
            )}
          </div>
        </section>
      </div>
      <DragArea></DragArea>
    </div>
  );
};

export default Home;
