/**
 * Copyright (c) 2025 Neura.
 * SPDX-License-Identifier: Apache-2.0
 */
import { useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import {
  Code2,
  Command,
  FileText,
  Globe2,
  Image,
  Loader2,
  MemoryStick,
  MonitorCog,
  Palette,
  Plug,
  Plus,
  Presentation,
  Search,
  Send,
  Terminal,
  X,
} from 'lucide-react';
import { motion } from 'framer-motion';

import { Button } from '@renderer/components/ui/button';
import { Textarea } from '@renderer/components/ui/textarea';
import { toast } from 'sonner';

import { useSession } from '../../hooks/useSession';

import { DragArea } from '../../components/Common/drag';
import { Operator } from '@main/store/types';
import { MANUS_STYLE_LAUNCHER_TASKS } from '@shared/taskLauncherCatalog';

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

const launcherIcon = {
  slides: Presentation,
  website: Globe2,
  code: Code2,
  design: Palette,
  research: Search,
  browser: MonitorCog,
  connectors: Plug,
};

const executionLayers = [
  {
    step: '01',
    title: 'Browser',
    detail: 'Clicks, navigation, scraping',
    icon: Globe2,
  },
  {
    step: '02',
    title: 'Shell',
    detail: 'Commands and project work',
    icon: Terminal,
  },
  {
    step: '03',
    title: 'Memory',
    detail: 'Context and learning',
    icon: MemoryStick,
  },
  {
    step: '04',
    title: 'Files',
    detail: 'Reports, sheets, artifacts',
    icon: FileText,
  },
];

const Home = () => {
  const navigate = useNavigate();
  const { createSession } = useSession();
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
      const session = await createSession(instructions, {
        operator: Operator.LocalComputer,
      });

      if (!session?.id) {
        toast.error('Could not create a task session. Please try again.');
        return;
      }

      navigate('/local', {
        state: {
          sessionId: session.id,
          from: 'home',
          initialPrompt: instructions,
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

  return (
    <div className="neura-home-page relative h-full w-full overflow-y-auto">
      <DragArea></DragArea>
      <div className="mx-auto flex min-h-full w-full max-w-[1320px] flex-col px-5 py-8 md:px-8">
        <section className="grid min-h-[calc(100vh-108px)] items-center gap-10 py-6 xl:grid-cols-[minmax(0,1fr)_430px]">
          <div className="mx-auto flex w-full max-w-[910px] flex-col items-center xl:items-start">
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.42, ease: [0.22, 1, 0.36, 1] }}
              className="mb-7 flex items-center gap-2 rounded-full border border-white/[0.1] bg-[#f5f1e8]/[0.045] px-4 py-2 text-[12px] font-semibold uppercase tracking-[0.18em] text-[#f5f1e8]/58"
            >
              <span className="h-1.5 w-1.5 rounded-full bg-[#f5f1e8] shadow-[0_0_18px_rgba(245,241,232,0.45)]" />
              Neura desktop
            </motion.div>
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.04, duration: 0.42, ease: [0.22, 1, 0.36, 1] }}
              className="text-center xl:text-left"
            >
              <h1 className="max-w-[860px] text-[54px] font-semibold leading-[0.9] tracking-normal text-[#f6f1e8] md:text-[86px]">
                Tell Neura.
                <br />
                Watch it work.
              </h1>
              <p className="mt-6 max-w-[620px] text-[15px] leading-6 text-[#f6f1e8]/48 xl:text-[16px]">
                One plain-language task becomes browser movement, terminal
                work, files, artifacts, and a visible computer session.
              </p>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1, duration: 0.44, ease: [0.22, 1, 0.36, 1] }}
              className="mt-10 w-full overflow-hidden rounded-[34px] border border-[#f6f1e8]/[0.12] bg-[#11100e]/95 shadow-[0_34px_110px_rgba(0,0,0,0.48),inset_0_1px_0_rgba(255,255,255,0.06)]"
            >
              <div className="relative min-h-[178px]">
                <input
                  ref={fileInputRef}
                  type="file"
                  className="hidden"
                  multiple
                  accept="image/*,video/*,audio/*,.pdf,.txt,.md,.csv,.json,.doc,.docx,.xls,.xlsx,.ppt,.pptx"
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
                  placeholder="Scrape 50 jobs into Excel, research competitors, edit my project, control the browser..."
                  className="min-h-[176px] resize-none border-0 bg-transparent px-6 py-5 pb-20 pr-16 text-[17px] leading-7 text-[#f6f1e8] shadow-none placeholder:text-[#f6f1e8]/32 focus-visible:ring-0"
                />
                {attachments.length > 0 && (
                  <div className="absolute bottom-[4.75rem] left-5 right-5 flex flex-wrap gap-2">
                    {attachments.map((file, index) => {
                      const AttachmentIcon = file.type?.startsWith('image/')
                        ? Image
                        : FileText;

                      return (
                        <div
                          key={`${file.name}-${file.size}-${index}`}
                          className="flex max-w-[240px] items-center gap-2 rounded-full border border-[#f6f1e8]/[0.12] bg-[#f6f1e8]/[0.055] px-3 py-1.5 text-xs text-[#f6f1e8]/82"
                          title={file.path || file.name}
                        >
                          <AttachmentIcon className="h-3.5 w-3.5 shrink-0 text-[#f6f1e8]/72" />
                          <span className="truncate">{file.name}</span>
                          <span className="shrink-0 text-white/42">
                            {formatBytes(file.size)}
                          </span>
                          <button
                            type="button"
                            className="ml-1 rounded-full text-[#f6f1e8]/42 transition hover:text-[#f6f1e8]"
                            onClick={() => removeAttachment(index)}
                          >
                            <X className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}
                <div className="absolute bottom-0 left-0 right-0 flex items-center justify-between border-t border-[#f6f1e8]/[0.09] bg-black/24 px-4 py-4">
                  <Button
                    type="button"
                    variant="secondary"
                    size="icon"
                    aria-label="Upload photos or files"
                    className="h-11 w-11 rounded-full border border-[#f6f1e8]/[0.12] bg-[#f6f1e8]/[0.055] text-[#f6f1e8]/78 hover:bg-[#f6f1e8]/[0.1] hover:text-[#f6f1e8]"
                    disabled={starting}
                    onClick={() => fileInputRef.current?.click()}
                    title="Upload photos or files"
                  >
                    <Plus className="h-5 w-5 stroke-[2.3]" />
                  </Button>
                  <Button
                    variant="secondary"
                    size="icon"
                    className="h-11 w-11 rounded-full bg-[#f6f1e8] text-black shadow-[0_12px_34px_rgba(246,241,232,0.14)] hover:bg-white disabled:bg-[#f6f1e8]/[0.08] disabled:text-[#f6f1e8]/28"
                    disabled={!hasInput || starting}
                    onClick={() => startUnifiedNeura()}
                    aria-label="Start Neura task"
                  >
                    {starting ? (
                      <Loader2 className="size-5 animate-spin" />
                    ) : (
                      <Send className="size-5" />
                    )}
                  </Button>
                </div>
              </div>
            </motion.div>

            <div className="mt-5 grid w-full gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {MANUS_STYLE_LAUNCHER_TASKS.map((action) => {
                const Icon = launcherIcon[action.iconKey];
                return (
                  <button
                    key={action.title}
                    type="button"
                    className="group flex min-h-[76px] items-center justify-between gap-3 rounded-2xl border border-[#f6f1e8]/[0.11] bg-[#f6f1e8]/[0.045] px-4 py-3 text-left transition hover:border-[#f6f1e8]/25 hover:bg-[#f6f1e8]/[0.075]"
                    onClick={() => setPrompt(action.prompt)}
                    title={action.expectedOutcome}
                  >
                    <div className="flex min-w-0 items-center gap-2">
                      <Icon className="h-4 w-4 shrink-0 text-[#f6f1e8]/70" />
                      <div className="min-w-0">
                        <span className="block truncate text-sm font-semibold text-[#f6f1e8]/86">
                          {action.title}
                        </span>
                        <span className="mt-1 block truncate text-xs text-[#f6f1e8]/42">
                          {action.detail}
                        </span>
                      </div>
                    </div>
                    <Command className="h-3.5 w-3.5 shrink-0 text-[#f6f1e8]/24 transition group-hover:text-[#f6f1e8]/48" />
                  </button>
                );
              })}
            </div>
          </div>

          <motion.aside
            initial={{ opacity: 0, x: 18 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.16, duration: 0.48, ease: [0.22, 1, 0.36, 1] }}
            className="hidden xl:block"
          >
            <div className="relative overflow-hidden rounded-[36px] border border-[#f6f1e8]/[0.12] bg-[#f6f1e8] p-5 text-[#11100e] shadow-[0_34px_110px_rgba(0,0,0,0.42)]">
              <div className="neura-portfolio-mark" aria-hidden="true">
                <span>AI</span>
              </div>
              <div className="relative">
                <div className="mb-12 flex items-center justify-between">
                  <div>
                    <div className="text-[13px] font-semibold uppercase tracking-[0.16em] text-black/48">
                      Neura process
                    </div>
                    <div className="mt-3 max-w-[250px] text-[30px] font-semibold leading-[0.95] tracking-normal">
                      Prompt to finished work.
                    </div>
                  </div>
                  <span className="rounded-full border border-black/10 bg-black/[0.04] px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-black/52">
                    Runtime
                  </span>
                </div>
                <div className="grid gap-2.5">
                  {executionLayers.map((layer) => {
                    const Icon = layer.icon;
                    return (
                      <div
                        key={layer.title}
                        className="flex items-center gap-3 rounded-[22px] border border-black/[0.08] bg-black/[0.035] p-3"
                      >
                        <div className="flex h-11 w-11 items-center justify-center rounded-[18px] border border-black/[0.08] bg-white/45">
                          <Icon className="h-4 w-4 text-black/58" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="text-[15px] font-semibold text-black/82">
                            {layer.title}
                          </div>
                          <div className="mt-0.5 truncate text-xs text-black/46">
                            {layer.detail}
                          </div>
                        </div>
                        <span className="text-[12px] font-semibold text-black/32">
                          {layer.step}
                        </span>
                      </div>
                    );
                  })}
                </div>
                <div className="mt-8 rounded-[24px] border border-black/[0.08] bg-black/[0.035] p-4">
                  <div className="text-[12px] font-semibold uppercase tracking-[0.16em] text-black/42">
                    Live cockpit
                  </div>
                  <div className="mt-2 text-sm leading-5 text-black/58">
                    When work starts, Neura switches from this launch page to
                    the computer, browser, terminal, and artifact view.
                  </div>
                </div>
              </div>
            </div>
          </motion.aside>
        </section>
      </div>
      <DragArea></DragArea>
    </div>
  );
};

export default Home;
