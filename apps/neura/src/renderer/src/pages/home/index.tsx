/**
 * Copyright (c) 2025 Neura.
 * SPDX-License-Identifier: Apache-2.0
 */
import { useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { FileText, Image, Loader2, Plus, Send, X } from 'lucide-react';
import { motion } from 'framer-motion';

import { Button } from '@renderer/components/ui/button';
import { Textarea } from '@renderer/components/ui/textarea';
import { MotionPanel, panelMotion } from '@renderer/components/magic/PremiumSurface';

import { useSession } from '../../hooks/useSession';
import { classifyInteractionForInstructions } from '../../utils/operatorRouting';

import { DragArea } from '../../components/Common/drag';

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

const Home = () => {
  const navigate = useNavigate();
  const { createSession } = useSession();
  const [prompt, setPrompt] = useState('');
  const [attachments, setAttachments] = useState<LocalAttachment[]>([]);
  const [starting, setStarting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const startUnifiedNeura = async () => {
    const rawPrompt = prompt.trim();
    const attachmentText = attachmentSummary(attachments);
    const instructions = attachmentText
      ? `${rawPrompt || 'Uploaded files'}\n\nAttached files:\n${attachmentText}`
      : rawPrompt;

    if (!instructions || starting) {
      return;
    }

    setStarting(true);
    const route = classifyInteractionForInstructions(instructions);
    const operator = route.operator;
    const session = await createSession(instructions, {
      operator,
    });

    navigate('/local', {
      state: {
        operator,
        sessionId: session?.id,
        from: 'home',
        initialPrompt: instructions,
        initialMode: route.mode,
      },
    });
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
    <div className="relative flex h-full w-full flex-col overflow-hidden bg-black">
      <DragArea></DragArea>
      <div className="relative z-10 flex h-full w-full flex-col items-center justify-center px-8">
        <MotionPanel
          {...panelMotion}
          className="mb-8 flex flex-col items-center text-center"
        >
          <div className="mb-5 flex h-11 w-11 items-center justify-center rounded-lg border border-white/15 bg-white text-xl font-semibold text-black">
            N
          </div>
          <h1 className="max-w-4xl text-center text-[34px] font-semibold leading-tight tracking-normal text-white">
            What can I help you build?
          </h1>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-white/48">
            Ask Neura to research, automate the browser, work with local files,
            generate artifacts, or inspect a project.
          </p>
        </MotionPanel>

        <div className="w-full max-w-3xl rounded-2xl border border-white/14 bg-[#0c0c0c] shadow-none">
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
            placeholder="Assign a task or ask anything"
            className="min-h-[154px] resize-none border-0 bg-transparent px-6 py-5 pb-16 pr-16 text-base leading-7 text-white shadow-none placeholder:text-white/36 focus-visible:ring-0"
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
                    className="flex max-w-[220px] items-center gap-2 rounded-md border border-white/10 bg-white/8 px-3 py-1 text-xs text-white/85"
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
            className="size-9 rounded-lg border border-white/12 bg-white/8 text-white hover:bg-white/14"
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
            className="size-9 rounded-lg bg-white text-black hover:bg-white/90 disabled:bg-white/10 disabled:text-white/35"
            disabled={!hasInput || starting}
            onClick={startUnifiedNeura}
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
      </div>
      <DragArea></DragArea>
    </div>
  );
};

export default Home;
