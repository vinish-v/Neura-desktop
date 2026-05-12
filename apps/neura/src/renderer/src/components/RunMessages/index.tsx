/**
 * Copyright (c) 2025 Neura.
 * SPDX-License-Identifier: Apache-2.0
 */
import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import {
  CheckCircle2,
  ChevronRight,
  Circle,
  Code2,
  FileText,
  Loader2,
} from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@renderer/utils';
import { Button } from '@renderer/components/ui/button';

import { IMAGE_PLACEHOLDER } from '@neura-desktop/shared/constants';
import Prompts from '../Prompts';
import { api } from '@renderer/api';

// import ChatInput from '@renderer/components/ChatInput';

import { SidebarTrigger } from '@renderer/components/ui/sidebar';
import { ShareOptions } from '@/renderer/src/components/RunMessages/ShareOptions';
import { ClearHistory } from '@/renderer/src/components/RunMessages/ClearHistory';
import { useStore } from '@renderer/hooks/useStore';
import { useSession } from '@renderer/hooks/useSession';

import ImageGallery from '../ImageGallery';
import {
  ErrorMessage,
  HumanTextMessage,
  AssistantTextMessage,
  LoadingText,
} from './Messages';
import { TaskRunPanel } from './TaskRunPanel';
import { CallUserIntervention } from './CallUserIntervention';
import { StatusEnum } from '@neura-desktop/shared/types';

const RunMessages = () => {
  const navigate = useNavigate();
  const { messages = [], thinking, errorMsg, taskState, status } = useStore();
  const containerRef = React.useRef<HTMLDivElement>(null);
  const suggestions: string[] = [];
  const { currentSessionId, chatMessages, updateMessages } = useSession();
  const isWelcome = currentSessionId === '';
  const [isRightPanelOpen, setIsRightPanelOpen] = useState(!isWelcome);

  useEffect(() => {
    if (currentSessionId && messages.length) {
      const existingMessagesSet = new Set(
        chatMessages.map(
          (msg) => `${msg.value}-${msg.from}-${msg.timing?.start}`,
        ),
      );
      const newMessages = messages.filter(
        (msg) =>
          !existingMessagesSet.has(
            `${msg.value}-${msg.from}-${msg.timing?.start}`,
          ),
      );
      const allMessages = [...chatMessages, ...newMessages];

      updateMessages(currentSessionId, allMessages);
    }
  }, [currentSessionId, chatMessages.length, messages.length]);

  useEffect(() => {
    if (!currentSessionId.length) {
      setIsRightPanelOpen(false);
    }
  }, [currentSessionId]);

  useEffect(() => {
    if (chatMessages.length) {
      setIsRightPanelOpen(true);
    }
  }, [chatMessages.length]);

  useEffect(() => {
    setTimeout(() => {
      containerRef.current?.scrollIntoView(false);
    }, 100);
  }, [messages, thinking, errorMsg]);

  const handleSelect = async (suggestion: string) => {
    await api.setInstructions({ instructions: suggestion });
  };

  const isCanvasArtifact = (artifactPath: string) =>
    /\.(html|css|js|jsx|ts|tsx|json|md|mdx)$/i.test(artifactPath);

  const openArtifactInCanvas = async (artifact: {
    title: string;
    path: string;
    sourceRunId?: string;
  }) => {
    try {
      const project = await api.createCanvasProject({
        title: artifact.title,
        artifactPath: artifact.path,
        sourceRunId: artifact.sourceRunId,
      });
      navigate('/canvas', { state: { projectId: project.id } });
    } catch (error) {
      toast.error('Could not open artifact in Canvas.');
    }
  };

  const renderChatList = () => {
    const isInternalAutomationCorrection = (value?: string) =>
      /previous response was not executable|authorized benign UI automation|Action Space|previous action had invalid coordinates|browser state has not changed after repeated actions|previous browser DOM action could not be executed|element id was stale|take a fresh screenshot\/DOM map|Could not (?:type into|click) that DOM element|Refresh the DOM map or use coordinate click\/type|reply with finished\(content=|visible current DOM element/i.test(
        value || '',
      );

    return (
      <div className="flex-1 w-full overflow-y-auto px-6 py-0 scrollbar-thin scrollbar-thumb-[#2a2a2a] scrollbar-track-transparent">
        <div ref={containerRef}>
          {!chatMessages?.length && suggestions?.length > 0 && (
            <Prompts suggestions={suggestions} onSelect={handleSelect} />
          )}

          <TaskRunPanel taskState={taskState} />

          {chatMessages?.map((message, idx) => {
            if (isInternalAutomationCorrection(message?.value)) {
              return null;
            }

            if (message?.from === 'human') {
              if (message?.value === IMAGE_PLACEHOLDER) {
                return null;
              }

              return (
                <HumanTextMessage
                  key={`message-${idx}`}
                  text={message?.value}
                />
              );
            }

            const { predictionParsed } = message;

            if (!predictionParsed?.length && message.value) {
              return (
                <AssistantTextMessage
                  key={`message-${idx}`}
                  text={message.value}
                />
              );
            }

            // Find the finished step
            const finishedStep = predictionParsed?.find(
              (step) =>
                step.action_type === 'finished' &&
                step.action_inputs?.content &&
                typeof step.action_inputs.content === 'string' &&
                step.action_inputs.content.trim().length > 0,
            );

            // Runtime internals are summarized by TaskRunPanel and Neura's Computer.
            // Avoid flooding the chat lane with raw action/debug events.
            return (
              <div key={idx}>
                {finishedStep?.action_inputs?.content ? (
                  <AssistantTextMessage
                    text={finishedStep.action_inputs.content}
                  />
                ) : null}
              </div>
            );
          })}

          {thinking && <LoadingText text={'Thinking...'} />}
          {errorMsg && <ErrorMessage text={errorMsg} />}
        </div>
      </div>
    );
  };

  const renderPlanPanel = () => (
    <aside className="hidden min-h-0 w-[260px] shrink-0 border-r border-[#2a2a2a] bg-[#0f0f0f] p-4 xl:block">
      <div className="mb-4 text-sm font-semibold text-white">Plan</div>
      <div className="space-y-2">
        {(taskState?.todoItems || []).map((item, index) => {
          const Icon =
            item.status === 'done'
              ? CheckCircle2
              : item.status === 'in_progress'
                ? Loader2
                : Circle;
          return (
            <div
              key={item.id}
              className="rounded-lg border border-[#2a2a2a] bg-[#171717] p-3"
            >
              <div className="flex items-start gap-2">
                <Icon
                  className={cn(
                    'mt-0.5 h-4 w-4 shrink-0',
                    item.status === 'done' && 'text-emerald-400',
                    item.status === 'in_progress' &&
                      'animate-spin text-blue-400',
                    item.status === 'pending' && 'text-[#666]',
                    item.status === 'failed' && 'text-red-400',
                  )}
                />
                <div className="min-w-0">
                  <div className="text-xs text-muted-foreground">
                    Step {index + 1}
                  </div>
                  <div className="mt-1 break-words text-sm text-white">
                    {item.text}
                  </div>
                </div>
              </div>
            </div>
          );
        })}
        {!taskState?.todoItems?.length && (
          <div className="text-sm text-muted-foreground">
            The plan appears when Neura starts working.
          </div>
        )}
      </div>
    </aside>
  );

  const renderArtifactPanel = () => (
    <aside
      className={cn(
        'min-h-0 border-l border-[#2a2a2a] bg-[#0f0f0f] transition-all duration-300 ease-in-out',
        isRightPanelOpen
          ? 'w-[340px] opacity-100'
          : 'w-0 overflow-hidden opacity-0',
      )}
    >
      <div className="flex h-full flex-col">
        <div className="border-b border-[#2a2a2a] p-4 text-sm font-semibold text-white">
          Artifacts
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {(taskState?.artifacts || []).length > 0 ? (
            <div className="space-y-2">
              {taskState?.artifacts.map((artifact) => (
                <div
                  key={artifact.id}
                  className="rounded-lg border border-[#2a2a2a] bg-[#171717] p-3 transition hover:border-blue-400/40"
                >
                  <button
                    type="button"
                    className="w-full text-left"
                    onClick={() => api.openPath({ path: artifact.path })}
                  >
                    <div className="flex items-center gap-2 text-sm text-white">
                      <FileText className="h-4 w-4 text-blue-300" />
                      <span className="truncate">{artifact.title}</span>
                    </div>
                    <div className="mt-1 truncate text-xs text-muted-foreground">
                      {artifact.path}
                    </div>
                  </button>
                  {isCanvasArtifact(artifact.path) && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="mt-3 w-full justify-center"
                      onClick={() => openArtifactInCanvas(artifact)}
                    >
                      <Code2 className="h-4 w-4" />
                      Open in Canvas
                    </Button>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <ImageGallery messages={chatMessages} />
          )}
        </div>
      </div>
    </aside>
  );

  return (
    <div className="flex h-full min-h-0 flex-1 justify-center bg-[#0a0a0a]">
      <CallUserIntervention
        status={status as StatusEnum}
        messages={chatMessages}
      />
      {taskState && renderPlanPanel()}
      <div
        className={cn(
          'flex min-w-0 flex-col transition-all duration-300 ease-in-out',
          taskState ? 'flex-1' : isRightPanelOpen ? 'w-1/2' : 'mx-auto w-2/3',
        )}
      >
        <div className="mb-1 flex h-11 w-full items-center border-b border-[#2a2a2a] bg-[#0a0a0a]">
          <SidebarTrigger className="ml-2 mr-auto size-9" />
          <ClearHistory />
          <ShareOptions />
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setIsRightPanelOpen(!isRightPanelOpen)}
            className="mr-4"
          >
            <ChevronRight
              className={cn(
                'h-4 w-4 transition-transform duration-200',
                isRightPanelOpen ? 'rotate-0' : 'rotate-180',
              )}
            />
          </Button>
        </div>
        {!isWelcome && renderChatList()}
        {/* <ChatInput /> */}
      </div>

      {taskState ? (
        renderArtifactPanel()
      ) : (
        <div
          className={cn(
            'h-full border-l border-[#2a2a2a] bg-[#0f0f0f] transition-all duration-300 ease-in-out',
            isRightPanelOpen
              ? 'w-1/2 opacity-100'
              : 'w-0 overflow-hidden opacity-0',
          )}
        >
          <ImageGallery messages={chatMessages} />
        </div>
      )}
    </div>
  );
};

export default RunMessages;
