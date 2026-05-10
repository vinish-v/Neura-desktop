/**
 * Copyright (c) 2025 Neura.
 * SPDX-License-Identifier: Apache-2.0
 */
import React, { useEffect, useState } from 'react';
import { ChevronRight } from 'lucide-react';
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

  const renderChatList = () => {
    const isInternalAutomationCorrection = (value?: string) =>
      /previous response was not executable|authorized benign UI automation|Action Space|previous action had invalid coordinates|browser state has not changed after repeated actions|previous browser DOM action could not be executed|element id was stale|take a fresh screenshot\/DOM map|Could not (?:type into|click) that DOM element|Refresh the DOM map or use coordinate click\/type|reply with finished\(content=|visible current DOM element/i.test(
        value || '',
      );

    return (
      <div className="flex-1 w-full px-12 py-0 overflow-y-auto scrollbar-thin scrollbar-thumb-gray-300 scrollbar-track-transparent hover:scrollbar-thumb-gray-400">
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

  return (
    <div className="flex-1 min-h-0 flex h-full justify-center">
      <CallUserIntervention
        status={status as StatusEnum}
        messages={chatMessages}
      />
      {/* Left Panel */}
      <div
        className={cn(
          'flex flex-col transition-all duration-300 ease-in-out',
          isRightPanelOpen ? 'w-1/2' : 'w-2/3 mx-auto',
        )}
      >
        <div className="flex w-full items-center mb-1">
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

      {/* Right Panel */}
      <div
        className={cn(
          'h-full border-l border-border bg-background transition-all duration-300 ease-in-out',
          isRightPanelOpen
            ? 'w-1/2 opacity-100'
            : 'w-0 opacity-0 overflow-hidden',
        )}
      >
        <ImageGallery messages={chatMessages} />
      </div>
    </div>
  );
};

export default RunMessages;
