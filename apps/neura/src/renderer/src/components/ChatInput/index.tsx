/**
 * Copyright (c) 2025 Neura.
 * SPDX-License-Identifier: Apache-2.0
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';

import { IMAGE_PLACEHOLDER } from '@neura-desktop/shared/constants';
import { StatusEnum } from '@neura-desktop/shared/types';

import { useRunAgent } from '@renderer/hooks/useRunAgent';
import { useStore } from '@renderer/hooks/useStore';

import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@renderer/components/ui/tooltip';
import { Button } from '@renderer/components/ui/button';
import { api } from '@renderer/api';

import {
  FileText,
  Image,
  Loader2,
  Play,
  Plus,
  Send,
  Square,
  X,
} from 'lucide-react';
import { Textarea } from '@renderer/components/ui/textarea';
import { useSession } from '@renderer/hooks/useSession';
import { cn } from '@renderer/utils';

import { Operator } from '@main/store/types';
import { useSetting } from '../../hooks/useSetting';
import {
  classifyInteractionForInstructions,
  selectOperatorForInstructions,
} from '../../utils/operatorRouting';

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

const AFFIRMATIVE_PATTERN =
  /^(yes|yep|yeah|ok|okay|sure|do it|go ahead|please do|confirm)\s*[!.?]*$/i;

const AUTOMATION_OFFER_PATTERN =
  /\b(would you like me to|do that now|use automation|automation mode|type .* into|open .* for you|click .* for you|save .* for you)\b/i;

const CORRECTION_AUTOMATION_PATTERN =
  /\b(you haven'?t|you did(?:n'?t| not)|not typed|type it|typed it|in (the )?notepad|into (the )?notepad|do it now|actually do)\b/i;

const INTERNAL_AUTOMATION_TEXT_PATTERN =
  /previous response was not executable|authorized benign UI automation|Action Space|previous action had invalid coordinates|browser state has not changed after repeated actions|previous browser DOM action could not be executed|element id was stale|take a fresh screenshot\/DOM map|Could not (?:type into|click) that DOM element|Refresh the DOM map or use coordinate click\/type|reply with finished\(content=|visible current DOM element/i;

const isInternalAutomationMessage = (value?: string) =>
  INTERNAL_AUTOMATION_TEXT_PATTERN.test(value || '');

const buildFollowUpAutomationInstructions = (
  instructions: string,
  history: ReturnType<typeof useSession>['chatMessages'],
) => {
  const trimmed = instructions.trim();
  const lastAssistant = [...history]
    .reverse()
    .find((message) => message.from === 'gpt' && message.value?.trim());
  const previousHuman = [...history]
    .reverse()
    .find((message) => message.from === 'human' && message.value?.trim());

  if (
    AFFIRMATIVE_PATTERN.test(trimmed) &&
    lastAssistant?.value &&
    AUTOMATION_OFFER_PATTERN.test(lastAssistant.value)
  ) {
    return {
      shouldAutomate: true,
      instructions: [
        'The user confirmed the pending local computer automation request.',
        previousHuman?.value
          ? `Previous user request or correction: ${previousHuman.value}`
          : '',
        lastAssistant.value
          ? `Assistant offer that was accepted: ${lastAssistant.value}`
          : '',
        'Actually operate the local computer now. Do not merely explain or promise. Complete the requested action, then report the result.',
      ]
        .filter(Boolean)
        .join('\n'),
    };
  }

  if (CORRECTION_AUTOMATION_PATTERN.test(trimmed)) {
    return {
      shouldAutomate: true,
      instructions: [
        'The user is correcting Neura because a promised local computer action was not performed.',
        `User correction: ${trimmed}`,
        previousHuman?.value
          ? `Relevant previous user request: ${previousHuman.value}`
          : '',
        'Use local computer automation to fix it now. Do not ask for confirmation unless the action is destructive.',
      ]
        .filter(Boolean)
        .join('\n'),
    };
  }

  return {
    shouldAutomate: false,
    instructions: trimmed,
  };
};

const ChatInput = ({
  operator,
  sessionId,
  disabled,
  checkBeforeRun,
  variant = 'default',
}: {
  operator: Operator;
  sessionId: string;
  disabled: boolean;
  checkBeforeRun?: () => Promise<boolean>;
  variant?: 'default' | 'shell';
}) => {
  const {
    status,
    instructions: savedInstructions,
    messages,
    restUserData,
  } = useStore();
  const [localInstructions, setLocalInstructions] = useState('');
  const [attachments, setAttachments] = useState<LocalAttachment[]>([]);
  const { run, stopAgentRuning } = useRunAgent();
  const { getSession, updateSession, updateMessages, chatMessages } =
    useSession();
  const { settings, updateSetting } = useSetting();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const running = status === StatusEnum.RUNNING;

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.focus();
    }
  }, []);

  useEffect(() => {
    if (status === StatusEnum.INIT) {
      return;
    }
  }, [status]);

  useEffect(() => {
    switch (operator) {
      case Operator.RemoteComputer:
        updateSetting({ ...settings, operator: Operator.RemoteComputer });
        break;
      case Operator.RemoteBrowser:
        updateSetting({ ...settings, operator: Operator.RemoteBrowser });
        break;
      case Operator.LocalComputer:
        updateSetting({ ...settings, operator: Operator.LocalComputer });
        break;
      case Operator.LocalBrowser:
        updateSetting({ ...settings, operator: Operator.LocalBrowser });
        break;
      default:
        updateSetting({ ...settings, operator: Operator.LocalComputer });
        break;
    }
  }, [operator]);

  const getInstantInstructions = () => {
    if (localInstructions?.trim()) {
      return localInstructions;
    }
    if (attachments.length) {
      return 'Uploaded files';
    }
    if (isCallUser && savedInstructions?.trim()) {
      return savedInstructions;
    }
    return '';
  };

  const startRun = async () => {
    if (checkBeforeRun) {
      const checked = await checkBeforeRun();

      if (!checked) {
        return;
      }
    }

    const rawInstructions = getInstantInstructions();
    const attachmentText = attachmentSummary(attachments);
    const instructions = attachmentText
      ? `${rawInstructions}\n\nAttached files:\n${attachmentText}`
      : rawInstructions;

    let history = chatMessages;
    const appendTextExchange = async (answer: string) => {
      const now = Date.now();
      const userMessage = {
        from: 'human' as const,
        value: instructions,
        timing: {
          start: now,
          end: now,
          cost: 0,
        },
      };
      const end = Date.now();
      const assistantMessage = {
        from: 'gpt' as const,
        value: answer,
        timing: {
          start: now,
          end,
          cost: end - now,
        },
      };

      await updateMessages(sessionId, [
        ...history,
        userMessage,
        assistantMessage,
      ]);
      setLocalInstructions('');
      setAttachments([]);
    };

    const followUpAutomation = buildFollowUpAutomationInstructions(
      instructions,
      history,
    );
    const effectiveInstructions = followUpAutomation.instructions;
    const interaction = followUpAutomation.shouldAutomate
      ? {
          mode: 'automation' as const,
          operator: Operator.LocalComputer,
          reason: 'confirmed pending automation',
        }
      : classifyInteractionForInstructions(effectiveInstructions, operator);

    if (interaction.mode === 'automation') {
      const quickTask = await api.runQuickLocalTask({
        instructions: effectiveInstructions,
      });
      if (quickTask.handled) {
        const session = await getSession(sessionId);
        await updateSession(sessionId, {
          name: session?.name === 'New Session' ? instructions : session?.name,
          meta: {
            ...(session?.meta || {}),
            operator: Operator.LocalComputer,
          },
        });
        await appendTextExchange(
          quickTask.message || 'Completed the local task.',
        );
        return;
      }
    }

    if (interaction.mode === 'direct') {
      const session = await getSession(sessionId);
      await updateSession(sessionId, {
        name: session?.name === 'New Session' ? instructions : session?.name,
        meta: {
          ...(session?.meta || {}),
          operator,
        },
      });

      const answer = await api.directChat({
        instructions,
        history,
      });
      await appendTextExchange(answer);
      return;
    }

    const routedOperator = selectOperatorForInstructions(
      effectiveInstructions,
      operator,
    );

    await updateSetting({ ...settings, operator: routedOperator });

    const session = await getSession(sessionId);
    await updateSession(sessionId, {
      name: session?.name === 'New Session' ? instructions : session?.name,
      meta: {
        ...session!.meta,
        operator: routedOperator,
        ...(restUserData || {}),
      },
    });

    run(
      effectiveInstructions,
      history,
      () => {
        setLocalInstructions('');
        setAttachments([]);
      },
      instructions,
    );
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

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.nativeEvent.isComposing) {
      return;
    }

    // `enter` to submit
    if (
      e.key === 'Enter' &&
      !e.shiftKey &&
      !e.metaKey &&
      getInstantInstructions()
    ) {
      e.preventDefault();

      startRun();
    }
  };

  const isCallUser = useMemo(() => status === StatusEnum.CALL_USER, [status]);

  const lastHumanMessage =
    [...(messages || [])]
      .reverse()
      .find(
        (m) =>
          m?.from === 'human' &&
          m?.value !== IMAGE_PLACEHOLDER &&
          !isInternalAutomationMessage(m?.value),
      )
      ?.value || '';

  const stopRun = async () => {
    await stopAgentRuning(() => {
      setLocalInstructions('');
      setAttachments([]);
    });
    await api.clearHistory();
  };

  const renderButton = () => {
    if (running) {
      return (
        <Button
          variant="secondary"
          size="icon"
          className="h-9 w-9 rounded-lg bg-white/10 text-white hover:bg-white/15"
          onClick={stopRun}
        >
          <Square className="h-4 w-4" />
        </Button>
      );
    }

    if (isCallUser && !localInstructions) {
      return (
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="secondary"
                size="icon"
                className="h-9 w-9 rounded-lg border border-white/20 bg-white/10 text-white hover:bg-white/15"
                onClick={startRun}
                disabled={!getInstantInstructions()}
              >
                <Play className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              <p className="whitespace-pre-line">
                send last instructions when you are done for Neura&apos;s
                &apos;CALL_USER&apos;
              </p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      );
    }

    return (
      <Button
        variant="secondary"
        size="icon"
        className="h-9 w-9 rounded-lg bg-white text-black hover:bg-white/90 disabled:bg-white/10 disabled:text-white/35"
        onClick={startRun}
        disabled={!getInstantInstructions() || disabled}
      >
        <Send className="h-4 w-4" />
      </Button>
    );
  };

  const isShellVariant = variant === 'shell';

  return (
    <div className={cn('w-full', isShellVariant ? 'px-0' : 'px-4')}>
      <div className="flex flex-col space-y-4">
        <motion.div
          className={cn(
            'relative w-full rounded-2xl border border-white/14 bg-[#0c0c0c]',
            isShellVariant ? 'border-white/16' : 'border-white/14',
          )}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
        >
          <div className="relative w-full rounded-2xl bg-transparent">
            <input
              ref={fileInputRef}
              type="file"
              className="hidden"
              multiple
              accept="image/*,.pdf,.txt,.md,.csv,.json,.doc,.docx,.xls,.xlsx,.ppt,.pptx"
              onChange={handleFileChange}
            />
            <Textarea
              ref={textareaRef}
              placeholder={
                isCallUser && savedInstructions
                  ? `${savedInstructions}`
                  : running && lastHumanMessage && messages?.length > 1
                    ? lastHumanMessage
                    : isShellVariant
                      ? 'Write a message...'
                      : 'What can I do for you today?'
              }
              className={cn(
                'resize-none border-0 px-5 pb-16 pt-5 text-[15px] leading-7 shadow-none focus-visible:ring-0',
                isShellVariant
                  ? 'min-h-[132px] rounded-2xl bg-transparent text-[17px] placeholder:text-white/40'
                  : 'min-h-[112px] rounded-2xl bg-transparent text-white placeholder:text-white/36',
              )}
              value={localInstructions}
              disabled={running || disabled}
              onChange={(e) => setLocalInstructions(e.target.value)}
              onKeyDown={handleKeyDown}
            />
            {attachments.length > 0 && (
              <div className="absolute bottom-14 left-4 right-4 flex flex-wrap gap-2">
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
            <div className="absolute bottom-4 left-4 flex items-center gap-2">
              <Button
                type="button"
                variant="secondary"
                size="icon"
                aria-label="Upload photos or files"
                className={cn(
                  'h-9 w-9 rounded-lg border shadow-sm transition-transform hover:scale-105 active:scale-95',
                  isShellVariant
                    ? 'border-white/15 bg-white/8 text-white hover:bg-white/14 hover:text-white'
                    : 'border-white/12 bg-white/8 text-white hover:bg-white/14',
                )}
                disabled={running || disabled}
                onClick={() => fileInputRef.current?.click()}
                title="Upload photos or files"
              >
                <Plus className="h-5 w-5 stroke-[2.5]" />
              </Button>
            </div>
            <div className="absolute right-4 bottom-4 flex items-center gap-2">
              {running && (
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
              )}
              {isShellVariant && !running && (
                <div className="hidden items-center gap-2 text-sm font-medium text-muted-foreground sm:flex">
                  <span>Neura</span>
                  <span className="h-4 w-px bg-border" />
                </div>
              )}
              {renderButton()}
            </div>
          </div>
        </motion.div>
      </div>
    </div>
  );
};

export default ChatInput;
