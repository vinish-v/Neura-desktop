/**
 * Copyright (c) 2025 Neura.
 * SPDX-License-Identifier: Apache-2.0
 */
import { useState } from 'react';
import { AlertCircle, Camera, ChevronDown, Loader2 } from 'lucide-react';
import { motion } from 'framer-motion';
import { ErrorStatusEnum } from '@neura-desktop/shared/types';

import { Button } from '@renderer/components/ui/button';
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from '@renderer/components/ui/alert';
import { Markdown } from '../markdown';

export const HumanTextMessage = ({ text }: { text: string }) => {
  return (
    <motion.div
      className="my-4 flex items-center gap-2"
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
    >
      <div className="ml-auto max-w-[82%] whitespace-pre-wrap break-words rounded-2xl bg-black px-4 py-3 text-sm font-medium leading-relaxed text-white shadow-lg">
        {text}
      </div>
    </motion.div>
  );
};

export const AssistantTextMessage = ({ text }: { text: string }) => {
  return (
    <motion.div
      className="mb-5 flex items-start gap-2"
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
    >
      <div className="mr-auto max-w-full overflow-x-auto break-words rounded-2xl border border-white/10 bg-white/[0.055] px-4 pb-1 pt-3 text-sm leading-relaxed shadow-sm">
        <Markdown>{text.replace(/\\n/g, '\n')}</Markdown>
      </div>
    </motion.div>
  );
};

interface ScreenshotMessageProps {
  onClick?: () => void;
}

export const ScreenshotMessage = ({ onClick }: ScreenshotMessageProps) => {
  return (
    <Button
      variant="outline"
      size="sm"
      className="h-8 rounded-full border-white/10 bg-white/[0.065] text-muted-foreground hover:bg-white/10"
      onClick={onClick}
    >
      <Camera className="w-4 h-4" />
      <span>Screenshot</span>
    </Button>
  );
};

const getError = (text: string) => {
  let error: { message: string; stack: string };
  try {
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed === 'object' && parsed.status) {
      const errorStatus = ErrorStatusEnum[parsed.status] || 'Error';
      const message = String(parsed.message || '');
      if (/no executable action|could not produce a valid next action/i.test(message)) {
        return {
          message: 'User action needed',
          stack:
            'Neura could not safely continue from the current page. Use Take over to complete any human verification or give a more direct instruction.',
        };
      }
      error = {
        message: `${errorStatus}: ${message}`,
        stack: parsed.stack || text,
      };
    } else {
      error = {
        message: `Error: ${parsed.message || ''}`,
        stack: parsed.stack || text,
      };
    }
  } catch (e) {
    error = {
      message: 'Error:',
      stack: text,
    };
  }

  return error;
};

export const ErrorMessage = ({ text }: { text: string }) => {
  const error = getError(text);
  const [isExpanded, setIsExpanded] = useState(false);

  const MAX_LINE = 2;
  const stackLines = error.stack.split('\n') || [];
  const hasMoreLines = stackLines.length > MAX_LINE;
  const displayedStack = isExpanded
    ? error.stack
    : stackLines.slice(0, MAX_LINE).join('\n');

  return (
    <Alert variant="destructive" className="my-4 border-destructive/50">
      <AlertCircle />
      <AlertTitle className="break-all">{error.message}</AlertTitle>
      <AlertDescription className="break-all whitespace-pre-wrap">
        {displayedStack}
        {hasMoreLines && (
          <Button
            variant="outline"
            size="icon"
            className="absolute right-2 bottom-2 w-7 h-7 cursor-pointer hover:bg-red-50 hover:text-red-500"
            onClick={() => setIsExpanded(!isExpanded)}
          >
            <ChevronDown className={isExpanded ? 'rotate-180' : ''} />
          </Button>
        )}
      </AlertDescription>
    </Alert>
  );
};

export const LoadingText = ({ text }: { text: string }) => {
  return (
    <div className="mt-4">
      <div className="inline-flex items-center gap-2 text-muted-foreground animate-pulse">
        <Loader2 className="h-4 w-4 animate-spin" />
        {text}
      </div>
    </div>
  );
};
