/**
 * Copyright (c) 2025 Neura.
 * SPDX-License-Identifier: Apache-2.0
 */
import { AlertTriangle, MessageSquareText } from 'lucide-react';
import { motion } from 'framer-motion';
import { StatusEnum } from '@neura-desktop/shared/types';
import { type ConversationWithSoM } from '@main/shared/types';

const getCallUserMessage = (messages: ConversationWithSoM[]) => {
  const callUser = [...messages]
    .reverse()
    .flatMap((message) => message.predictionParsed || [])
    .find((step) => step.action_type === 'call_user');

  const content = callUser?.action_inputs?.content;
  return (
    callUser?.thought ||
    (typeof content === 'string' ? content : '') ||
    'Neura needs guidance before it can continue.'
  );
};

export function CallUserIntervention({
  status,
  messages,
}: {
  status: StatusEnum;
  messages: ConversationWithSoM[];
}) {
  if (status !== StatusEnum.CALL_USER) {
    return null;
  }

  return (
    <div className="pointer-events-none fixed inset-x-0 top-4 z-40 flex justify-center px-4">
      <motion.div
        initial={{ opacity: 0, y: -16, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.24 }}
        className="pointer-events-auto neura-glass neura-agent-pulse max-w-[720px] rounded-2xl px-5 py-4"
      >
        <div className="flex items-start gap-4">
          <span className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-amber-300/30 bg-amber-300/15">
            <span className="absolute inset-0 animate-ping rounded-xl bg-amber-300/10" />
            <AlertTriangle className="relative h-5 w-5 text-amber-100" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 text-sm font-semibold text-white">
              <MessageSquareText className="h-4 w-4 text-cyan-200" />
              User guidance required
            </div>
            <div className="mt-1 text-sm leading-6 text-muted-foreground">
              {getCallUserMessage(messages)}
            </div>
            <div className="mt-3 text-xs text-amber-100">
              Reply in the composer below. Neura will resume from this
              checkpoint after you send guidance.
            </div>
          </div>
        </div>
      </motion.div>
    </div>
  );
}
