/**
 * Copyright (c) 2025 Neura.
 * SPDX-License-Identifier: Apache-2.0
 */
import { useEffect, useMemo, useRef } from 'react';
import { useLocation } from 'react-router';

import ChatInput from '@renderer/components/ChatInput';
import RunMessages from '@renderer/components/RunMessages';
import { useRunAgent } from '@renderer/hooks/useRunAgent';
import { useSession } from '@renderer/hooks/useSession';
import { useSetting } from '@renderer/hooks/useSetting';

import { Operator } from '@main/store/types';

type LocalRouteState = {
  operator?: Operator;
  sessionId?: string;
  initialPrompt?: string;
  from?: 'home' | 'history';
};

const LocalOperator = () => {
  const location = useLocation();
  const routeState = (location.state || {}) as LocalRouteState;
  const startedInitialRunRef = useRef(false);
  const { run } = useRunAgent();
  const {
    currentSessionId,
    setCurrentSessionId,
    getMessages,
    chatMessages,
  } = useSession();
  const { settings, updateSetting } = useSetting();

  const operator = useMemo(
    () => routeState.operator || settings.operator || Operator.LocalComputer,
    [routeState.operator, settings.operator],
  );
  const sessionId = routeState.sessionId || currentSessionId;

  useEffect(() => {
    if (!routeState.sessionId) {
      return;
    }

    setCurrentSessionId(routeState.sessionId);
    getMessages(routeState.sessionId);
  }, [routeState.sessionId]);

  useEffect(() => {
    const initialPrompt = routeState.initialPrompt?.trim();
    if (!initialPrompt || startedInitialRunRef.current) {
      return;
    }

    startedInitialRunRef.current = true;

    const startInitialRun = async () => {
      await updateSetting({ ...settings, operator });
      await run(initialPrompt, [], undefined, initialPrompt, operator);
    };

    startInitialRun().catch((error) => {
      console.error('startInitialRun', error);
      startedInitialRunRef.current = false;
    });
  }, [routeState.initialPrompt, operator]);

  return (
    <div className="flex h-full min-h-0 w-full flex-col overflow-hidden bg-black">
      <div className="min-h-0 flex-1">
        <RunMessages />
      </div>
      <div className="shrink-0 border-t border-white/10 bg-black px-6 py-4">
        <div className="mx-auto max-w-5xl">
          <ChatInput
            operator={operator}
            sessionId={sessionId}
            disabled={!sessionId}
            variant={chatMessages.length ? 'shell' : 'default'}
          />
        </div>
      </div>
    </div>
  );
};

export default LocalOperator;
