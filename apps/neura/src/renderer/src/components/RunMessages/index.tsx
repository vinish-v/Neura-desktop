/**
 * Copyright (c) 2025 Neura.
 * SPDX-License-Identifier: Apache-2.0
 */
import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { Code2, FileText, PanelRightClose, PanelRightOpen } from 'lucide-react';
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
  const scrollContainerRef = React.useRef<HTMLDivElement>(null);
  const bottomRef = React.useRef<HTMLDivElement>(null);
  const shouldStickToBottomRef = React.useRef(true);
  const suggestions: string[] = [];
  const { currentSessionId, chatMessages, updateMessages } = useSession();
  const isWelcome = currentSessionId === '';
  const [isComputerOpen, setIsComputerOpen] = useState(!isWelcome);

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
      setIsComputerOpen(false);
    }
  }, [currentSessionId]);

  useEffect(() => {
    if (chatMessages.length) {
      setIsComputerOpen(true);
    }
  }, [chatMessages.length]);

  useEffect(() => {
    setTimeout(() => {
      if (!shouldStickToBottomRef.current) {
        return;
      }
      bottomRef.current?.scrollIntoView({ block: 'end' });
    }, 100);
  }, [
    messages.length,
    thinking,
    errorMsg,
    taskState?.progressItems.length,
    taskState?.toolCalls.length,
    taskState?.status,
  ]);

  const handleChatScroll = () => {
    const element = scrollContainerRef.current;
    if (!element) {
      return;
    }
    const distanceFromBottom =
      element.scrollHeight - element.scrollTop - element.clientHeight;
    shouldStickToBottomRef.current = distanceFromBottom < 140;
  };

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
      <div
        ref={scrollContainerRef}
        onScroll={handleChatScroll}
        className="min-h-0 flex-1 w-full overflow-y-auto overscroll-contain px-6 py-0 scrollbar-thin scrollbar-thumb-[#2a2a2a] scrollbar-track-transparent"
      >
        <div className="pb-8 pt-4">
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
          <div ref={bottomRef} className="h-1" />
        </div>
      </div>
    );
  };

  const renderComputerPanel = () => (
    <aside
      className={cn(
        'min-h-0 shrink-0 border-l border-white/[0.08] bg-[#080909] transition-[width,opacity] duration-300 ease-out',
        isComputerOpen
          ? taskState
            ? 'w-[min(50vw,920px)] min-w-[520px] opacity-100'
            : 'w-1/2 opacity-100'
          : 'w-0 overflow-hidden opacity-0',
      )}
    >
      <div className="flex h-full flex-col">
        <div className="min-h-0 flex-1 p-4">
          {(taskState?.artifacts || []).length > 0 ? (
            <div className="flex h-full min-h-0 flex-col gap-4">
              <div className="min-h-0 flex-1">
                <ImageGallery
                  messages={chatMessages}
                  onClose={() => setIsComputerOpen(false)}
                />
              </div>
              <div className="max-h-40 shrink-0 overflow-y-auto border-t border-white/[0.08] pt-3">
                <div className="mb-2 text-[11px] font-medium uppercase text-white/35">
                  Artifacts
                </div>
                <div className="grid gap-2">
                  {taskState?.artifacts.slice(-4).map((artifact) => (
                    <div
                      key={artifact.id}
                      className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-xs text-white/76 transition hover:bg-white/[0.04]"
                    >
                      <FileText className="h-3.5 w-3.5 shrink-0 text-blue-200/75" />
                      <button
                        type="button"
                        className="min-w-0 flex-1 truncate text-left"
                        onClick={() => api.openPath({ path: artifact.path })}
                        title={artifact.path}
                      >
                        {artifact.title}
                      </button>
                      {isCanvasArtifact(artifact.path) && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 rounded-md px-2 text-xs text-white/55 hover:bg-white/[0.08] hover:text-white"
                          onClick={() => openArtifactInCanvas(artifact)}
                        >
                          <Code2 className="h-3.5 w-3.5" />
                          Canvas
                        </Button>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            <ImageGallery
              messages={chatMessages}
              onClose={() => setIsComputerOpen(false)}
            />
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
      <div
        className={cn(
          'flex min-w-0 flex-col transition-all duration-300 ease-in-out',
          taskState ? 'flex-1' : isComputerOpen ? 'w-1/2' : 'mx-auto w-2/3',
        )}
      >
        <div className="mb-1 flex h-11 w-full items-center border-b border-[#2a2a2a] bg-[#0a0a0a]">
          <SidebarTrigger className="ml-2 mr-auto size-9" />
          <ClearHistory />
          <ShareOptions />
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setIsComputerOpen((value) => !value)}
            className="mr-4 h-8 rounded-lg px-2 text-xs text-white/60 hover:bg-white/[0.07] hover:text-white"
            aria-label={
              isComputerOpen ? "Close Neura's Computer" : "Open Neura's Computer"
            }
          >
            {isComputerOpen ? (
              <PanelRightClose className="h-4 w-4" />
            ) : (
              <PanelRightOpen className="h-4 w-4" />
            )}
            <span className="hidden md:inline">Computer</span>
          </Button>
        </div>
        {!isWelcome && renderChatList()}
        {/* <ChatInput /> */}
      </div>

      {renderComputerPanel()}
    </div>
  );
};

export default RunMessages;
