/**
 * Copyright (c) 2025 Neura.
 * SPDX-License-Identifier: Apache-2.0
 */

export type IntentSurface = 'direct' | 'browser' | 'computer' | 'mixed';

export type IntentKind =
  | 'chat'
  | 'direct_answer'
  | 'browser_navigation'
  | 'browser_research'
  | 'local_file'
  | 'local_app'
  | 'shell'
  | 'process'
  | 'artifact'
  | 'website'
  | 'multimodal'
  | 'mixed';

export type SharedIntentDecision = {
  surface: IntentSurface;
  firstOperator: 'browser' | 'computer';
  kind: IntentKind;
  confidence: number;
  reason: string;
  signals: {
    direct: boolean;
    browser: boolean;
    computer: boolean;
    shell: boolean;
    localFile: boolean;
    localApp: boolean;
    currentWeb: boolean;
    artifact: boolean;
    websiteBuild: boolean;
    multimodal: boolean;
  };
};

const SIMPLE_CHAT_PATTERN =
  /^(hi|hii|hello|hey|yo|thanks|thank you|ok|okay|cool|nice|good morning|good afternoon|good evening)\s*[!.?]*$/i;

const DIRECT_ANSWER_PATTERN =
  /\b(what is|what's|who is|who's|why is|why does|how does|how do i|how to|explain|define|tell me about|summari[sz]e|write|draft|compose|translate|calculate|convert|compare|suggest|recommend|brainstorm)\b/i;

const INFORMATIONAL_QUESTION_PATTERN =
  /^(what|who|why|where|when|how|explain|define|tell me|can you explain|can you tell me)\b/i;

const PERSONAL_LOCAL_SCOPE_PATTERN =
  /\b(my|this computer|this machine|installed|local|desktop|downloads?|documents?|workspace|project folder|current folder|attached|uploaded|on my computer|on my machine)\b/i;

const CURRENT_WEB_PATTERN =
  /\b(latest|current|today|tonight|tomorrow|yesterday|now|live|breaking|news|weather|forecast|price|prices|stock|stocks|crypto|score|scores|fixture|fixtures|schedule|results?|near me|available|availability|book|booking|buy|ticket|tickets|sale|sales|ranking|rankings|reviews?|official|verify|source-backed|sources?)\b/i;

const URL_OR_DOMAIN_PATTERN =
  /\b(https?:\/\/|www\.|[a-z0-9-]+\.(com|org|net|io|ai|app|dev|in|co|edu|gov)(\/|\b))/i;

const BROWSER_PATTERN =
  /\b(website|web site|webpage|web page|browser|chrome|edge|google|bing|duckduckgo|search|look up|lookup|find online|find on|go to|navigate|visit|open site|open website|url|github|book\s*my\s*show|bookmyshow|amazon|flipkart|youtube|linkedin|gmail|mail|login|sign in|sign up|form|online|site|article|page|web)\b/i;

const WEB_EXTRACTION_PATTERN =
  /\b(extract|scrape|download|monitor|watch|summari[sz]e|read)\b.*\b(website|webpage|web page|url|page|links?|tables?|html|article|site)\b/i;

const SHELL_PATTERN =
  /\b(shell|terminal|powershell|command prompt|cmd|command line|cli|run_command|execute command|run command|run the command|npm|pnpm|yarn|node|python|pip|git|docker|java|cargo|go test|pytest|vitest|build|test|lint|typecheck|compile)\b/i;

const PROCESS_PATTERN =
  /\b(run|start|stop|restart|install|serve|server|watcher|background process|process|daemon|dev server|localhost|port)\b/i;

const LOCAL_FILE_PATTERN =
  /\b(read|write|edit|create|make|save|delete|remove|move|copy|rename|zip|unzip|extract|inspect|list|open)\b.*\b(file|folder|directory|dir|docx|pdf|xlsx|csv|pptx|spreadsheet|document|downloads|desktop|documents|path|archive)\b|\b(attached files?|uploaded files?|downloads?|desktop|documents?|local file|local folder|workspace|project folder)\b/i;

const LOCAL_APP_PATTERN =
  /\b(application|program|software|local app|desktop app|installed app|window|screen|keyboard|mouse|hotkey|shortcut|screenshot|computer|machine|\.exe)\b/i;

const LOCAL_APP_CONTROL_PATTERN =
  /\b(open|launch|focus|click|type|paste|press|scroll|select|fill|submit|send|message|text|dm|close|move|resize|screenshot)\b.*\b(app|application|program|software|window|screen|desktop|\.exe)\b/i;

const MESSAGE_SEND_PATTERN =
  /\b(send|message|text|dm)\b.+\bto\b.+(?:\b(on|via|using)\b.+)?$/i;

const APP_ACTION_CHAIN_PATTERN =
  /\b(open|launch|start|focus)\s+([a-z0-9][a-z0-9 ._-]{1,80})\s+(?:and|then)\s+\b(send|message|text|dm|type|click|press|select|fill|submit)\b/i;

const GENERIC_LOCAL_APP_CONTROL_PATTERN =
  /\b(open|launch|start|focus)\s+([a-z0-9][a-z0-9 ._-]{1,80})(?:\.exe\b|\s+(?:app|application|program|software)\b|\s+(?:and|then|to|for|with)\b|$)/i;

const WEBSITE_BUILD_PATTERN =
  /\b(build|create|generate|make|develop|implement)\b.*\b(website|web app|landing page|vite app|react app|next app|full-stack app|frontend app|dashboard)\b/i;

const WIDE_RESEARCH_PATTERN =
  /\b(wide research|parallel research|research\s+\d+|analy[sz]e\s+(all|these|\d+)|compare\s+(all|these|\d+)|batch research|lead generation|prospects|competitors list)\b/i;

const ARTIFACT_PATTERN =
  /\b(create|generate|make|build|export)\b.*\b(deck|slides?|pptx|presentation|report|pdf|docx|spreadsheet|xlsx|dashboard|csv)\b/i;

const MULTIMODAL_PATTERN =
  /\b(generate image|create image|image generation|edit image|transcribe|speech to text|text to speech|voiceover|analy[sz]e video|video understanding)\b/i;

const EXPLICIT_CONTROL_PATTERN =
  /\b(open|launch|click|type|write|paste|press|scroll|select|fill|submit|send|message|text|dm|download|upload|attach|install|run|execute|start|stop|restart|close|move|copy|delete|remove|rename|create|save|navigate|go to|visit|search|look up|find|check|get|show|list|inspect|read|edit)\b/i;

const LOCAL_ARTIFACT_TARGET_PATTERN =
  /\b(save|export|write|create|make|download|set)\b.*\b(file|folder|directory|desktop|downloads|documents|csv|xlsx|pdf|docx|pptx|background|wallpaper|local)\b/i;

const tokenCount = (text: string) => text.split(/\s+/).filter(Boolean).length;

export function classifyUserIntent(instructions: string): SharedIntentDecision {
  const text = instructions.trim();
  const lower = text.toLowerCase();

  const simpleChat = !text || SIMPLE_CHAT_PATTERN.test(text);
  const wideResearch = WIDE_RESEARCH_PATTERN.test(text);
  const websiteBuild = WEBSITE_BUILD_PATTERN.test(text);
  const artifact = ARTIFACT_PATTERN.test(text);
  const multimodal = MULTIMODAL_PATTERN.test(text);
  const shell = SHELL_PATTERN.test(text);
  const process = PROCESS_PATTERN.test(text) && shell;
  const localFile = LOCAL_FILE_PATTERN.test(text);
  const currentWeb = CURRENT_WEB_PATTERN.test(text);
  const urlOrDomain = URL_OR_DOMAIN_PATTERN.test(text);
  const explicitControl = EXPLICIT_CONTROL_PATTERN.test(text);
  const messageSend = MESSAGE_SEND_PATTERN.test(text);
  const appActionChain = APP_ACTION_CHAIN_PATTERN.test(text);
  const browserCandidate =
    !websiteBuild &&
    !messageSend &&
    !appActionChain &&
    (urlOrDomain ||
      BROWSER_PATTERN.test(text) ||
      WEB_EXTRACTION_PATTERN.test(text) ||
      currentWeb);
  const localApp =
    LOCAL_APP_PATTERN.test(text) ||
    LOCAL_APP_CONTROL_PATTERN.test(text) ||
    messageSend ||
    appActionChain ||
    (GENERIC_LOCAL_APP_CONTROL_PATTERN.test(text) && !browserCandidate);
  const browser = browserCandidate;
  const computer =
    websiteBuild ||
    wideResearch ||
    artifact ||
    multimodal ||
    shell ||
    process ||
    localFile ||
    localApp;
  const direct =
    simpleChat ||
    (DIRECT_ANSWER_PATTERN.test(text) &&
      !browser &&
      !computer &&
      !currentWeb &&
      !explicitControl);
  const mixed =
    browser &&
    computer &&
    (LOCAL_ARTIFACT_TARGET_PATTERN.test(text) ||
      /\b(research|find|scrape|extract|download|summari[sz]e)\b.*\b(save|export|write|create|file|csv|xlsx|pdf|docx|desktop|downloads|documents)\b/i.test(
        text,
      ));

  const signals = {
    direct,
    browser,
    computer,
    shell,
    localFile,
    localApp,
    currentWeb,
    artifact,
    websiteBuild,
    multimodal,
  };

  if (
    INFORMATIONAL_QUESTION_PATTERN.test(text) &&
    !currentWeb &&
    !urlOrDomain &&
    !WEB_EXTRACTION_PATTERN.test(text) &&
    !PERSONAL_LOCAL_SCOPE_PATTERN.test(text)
  ) {
    return {
      surface: 'direct',
      firstOperator: 'computer',
      kind: 'direct_answer',
      confidence: 0.9,
      reason: 'informational question answerable without operating tools',
      signals,
    };
  }

  if (simpleChat) {
    return {
      surface: 'direct',
      firstOperator: 'computer',
      kind: 'chat',
      confidence: 0.98,
      reason: 'plain conversational message',
      signals,
    };
  }

  if (wideResearch) {
    return {
      surface: 'computer',
      firstOperator: 'computer',
      kind: 'browser_research',
      confidence: 0.92,
      reason: 'wide or batch research belongs to local workflow tools',
      signals,
    };
  }

  if (mixed) {
    return {
      surface: 'mixed',
      firstOperator: browser ? 'browser' : 'computer',
      kind: 'mixed',
      confidence: 0.9,
      reason: 'task needs both web context and local output or OS action',
      signals,
    };
  }

  if (websiteBuild) {
    return {
      surface: 'computer',
      firstOperator: 'computer',
      kind: 'website',
      confidence: 0.92,
      reason: 'website/app build belongs to local workflow tools',
      signals,
    };
  }

  if (artifact) {
    return {
      surface: 'computer',
      firstOperator: 'computer',
      kind: 'artifact',
      confidence: 0.9,
      reason: 'artifact generation belongs to local workflow tools',
      signals,
    };
  }

  if (multimodal) {
    return {
      surface: 'computer',
      firstOperator: 'computer',
      kind: 'multimodal',
      confidence: 0.9,
      reason: 'multimodal generation or analysis workflow requested',
      signals,
    };
  }

  if (shell || process) {
    return {
      surface: 'computer',
      firstOperator: 'computer',
      kind: process ? 'process' : 'shell',
      confidence: 0.91,
      reason: 'shell, process, build, or runtime task requires computer tools',
      signals,
    };
  }

  if (localFile || localApp) {
    return {
      surface: 'computer',
      firstOperator: 'computer',
      kind: localFile ? 'local_file' : 'local_app',
      confidence: 0.88,
      reason:
        'local file, app, window, or desktop task requires computer tools',
      signals,
    };
  }

  if (browser) {
    return {
      surface: 'browser',
      firstOperator: 'browser',
      kind:
        currentWeb || WEB_EXTRACTION_PATTERN.test(text)
          ? 'browser_research'
          : 'browser_navigation',
      confidence: currentWeb || urlOrDomain ? 0.9 : 0.84,
      reason: currentWeb
        ? 'current or source-backed web information requires browser tools'
        : 'web navigation or browser automation requested',
      signals,
    };
  }

  if (direct || tokenCount(lower) <= 8) {
    return {
      surface: 'direct',
      firstOperator: 'computer',
      kind: direct ? 'direct_answer' : 'chat',
      confidence: direct ? 0.86 : 0.72,
      reason: 'answerable without operating browser, shell, files, or desktop',
      signals,
    };
  }

  return {
    surface: 'direct',
    firstOperator: 'computer',
    kind: 'direct_answer',
    confidence: 0.6,
    reason: 'no reliable automation signal detected',
    signals,
  };
}
