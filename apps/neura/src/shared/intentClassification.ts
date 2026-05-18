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
  | 'connector'
  | 'automation'
  | 'mixed';

export type SemanticTaskType =
  | 'conversation'
  | 'answer'
  | 'browser_operator'
  | 'wide_research'
  | 'local_computer'
  | 'shell_or_process'
  | 'artifact_creation'
  | 'slide_creation'
  | 'website_build'
  | 'app_development'
  | 'design_creation'
  | 'multimodal_creation'
  | 'connector_workflow'
  | 'automation'
  | 'mixed_workflow';

export type IntentRiskLevel = 'low' | 'medium' | 'high';

export type SemanticIntentContract = {
  taskType: SemanticTaskType;
  requiredTools: Array<
    | 'browser'
    | 'shell'
    | 'files'
    | 'local_app'
    | 'documents'
    | 'website'
    | 'multimodal'
    | 'connectors'
    | 'scheduler'
  >;
  riskLevel: IntentRiskLevel;
  expectedArtifacts: string[];
  needsApproval: boolean;
  verificationRequired: boolean;
  completionProof:
    | 'none'
    | 'final_answer'
    | 'sources'
    | 'artifacts'
    | 'local_action'
    | 'connector_audit'
    | 'mixed';
};

export type SharedIntentDecision = {
  surface: IntentSurface;
  firstOperator: 'browser' | 'computer';
  kind: IntentKind;
  confidence: number;
  reason: string;
  contract: SemanticIntentContract;
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
    connector: boolean;
    wideResearch: boolean;
    slides: boolean;
    design: boolean;
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

const RANKED_WEB_LIST_PATTERN =
  /\b(top|best|popular|trending|highest[- ]rated|most[- ]watched|most[- ]played|most[- ]searched)\s+(?:\d+\s+)?(?:movies?|games?|songs?|series|shows?|books?|restaurants?|places?|products?|phones?|laptops?|apps?|websites?|headlines?|news)\b|\btop\s+\d+\b/i;

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

const APP_DEVELOPMENT_PATTERN =
  /\b(develop|build|create|implement|code|fix|debug)\b.*\b(app|application|feature|repo|project|component|backend|frontend|api)\b/i;

const WIDE_RESEARCH_PATTERN =
  /\b(wide research|parallel research|research\s+\d+|analy[sz]e\s+(all|these|\d+)|compare\s+(all|these|\d+)|batch research|lead generation|prospects|competitors list)\b/i;

const ARTIFACT_PATTERN =
  /\b(create|generate|make|build|export)\b.*\b(deck|slides?|pptx|presentation|report|pdf|docx|spreadsheet|xlsx|dashboard|csv)\b/i;

const SLIDES_PATTERN =
  /\b(create|generate|make|build|design|prepare)\b.*\b(deck|slides?|pptx|presentation)\b/i;

const DESIGN_PATTERN =
  /\b(design|mockup|wireframe|visual direction|brand|logo|poster|banner|asset|image concept)\b/i;

const MULTIMODAL_PATTERN =
  /\b(generate image|create image|image generation|edit image|transcribe|speech to text|text to speech|voiceover|analy[sz]e video|video understanding)\b/i;

const CONNECTOR_PATTERN =
  /\b(connector|connectors|github|slack|drive|google drive|gmail|notion|mcp|webhook|oauth|automation|automations|zapier|workflow)\b/i;

const SCHEDULER_PATTERN =
  /\b(schedule|scheduled|every|daily|weekly|cron|remind|automation|automations)\b/i;

const WRITE_OR_EXTERNAL_PATTERN =
  /\b(write|send|post|publish|commit|push|upload|delete|remove|move|rename|approve|external|github|slack|drive|gmail|notion|webhook)\b/i;

const EXPLICIT_CONTROL_PATTERN =
  /\b(open|launch|click|type|write|paste|press|scroll|select|fill|submit|send|message|text|dm|download|upload|attach|install|run|execute|start|stop|restart|close|move|copy|delete|remove|rename|create|save|navigate|go to|visit|search|look up|find|check|get|show|list|inspect|read|edit)\b/i;

const LOCAL_ARTIFACT_TARGET_PATTERN =
  /\b(save|export|write|create|make|download|set)\b.*\b(file|folder|directory|desktop|downloads|documents|csv|xlsx|pdf|docx|pptx|background|wallpaper|local)\b/i;

const tokenCount = (text: string) => text.split(/\s+/).filter(Boolean).length;

const unique = <T>(items: T[]) => [...new Set(items)];

const buildContract = (input: {
  taskType: SemanticTaskType;
  browser?: boolean;
  shell?: boolean;
  localFile?: boolean;
  localApp?: boolean;
  websiteBuild?: boolean;
  multimodal?: boolean;
  connector?: boolean;
  scheduler?: boolean;
  artifact?: boolean;
  slides?: boolean;
  design?: boolean;
  currentWeb?: boolean;
  mixed?: boolean;
  text: string;
}): SemanticIntentContract => {
  const requiredTools = unique(
    [
      input.browser || input.currentWeb ? 'browser' : undefined,
      input.shell ? 'shell' : undefined,
      input.localFile ? 'files' : undefined,
      input.localApp ? 'local_app' : undefined,
      input.artifact || input.slides || input.design ? 'documents' : undefined,
      input.websiteBuild ? 'website' : undefined,
      input.multimodal ? 'multimodal' : undefined,
      input.connector ? 'connectors' : undefined,
      input.scheduler ? 'scheduler' : undefined,
    ].filter(Boolean) as SemanticIntentContract['requiredTools'],
  );
  const expectedArtifacts = unique(
    [
      input.slides ? 'presentation' : undefined,
      input.websiteBuild ? 'website_project' : undefined,
      input.artifact ? 'document_or_data_file' : undefined,
      input.design ? 'design_asset' : undefined,
      input.multimodal ? 'media_file' : undefined,
      input.localFile ? 'local_file' : undefined,
      input.connector ? 'connector_audit' : undefined,
      input.currentWeb || input.browser ? 'citation_records' : undefined,
    ].filter(Boolean) as string[],
  );
  const needsApproval =
    input.connector ||
    input.scheduler ||
    (input.localFile && /delete|remove|move|rename|overwrite/i.test(input.text)) ||
    WRITE_OR_EXTERNAL_PATTERN.test(input.text);
  const highRisk =
    /delete|remove|overwrite|payment|credential|password|secret|admin|production|push|publish/i.test(
      input.text,
    );
  const mediumRisk =
    needsApproval ||
    input.shell ||
    input.localApp ||
    input.connector ||
    input.scheduler;
  const riskLevel: IntentRiskLevel = highRisk
    ? 'high'
    : mediumRisk
      ? 'medium'
      : 'low';
  const verificationRequired = Boolean(
    input.mixed ||
    input.browser ||
    input.currentWeb ||
    input.localFile ||
    input.shell ||
    input.localApp ||
    input.artifact ||
    input.slides ||
    input.design ||
    input.websiteBuild ||
    input.multimodal ||
    input.connector,
  );

  return {
    taskType: input.taskType,
    requiredTools,
    riskLevel,
    expectedArtifacts,
    needsApproval,
    verificationRequired,
    completionProof: input.mixed
      ? 'mixed'
      : input.connector
        ? 'connector_audit'
        : input.artifact ||
            input.slides ||
            input.design ||
            input.websiteBuild ||
            input.multimodal
          ? 'artifacts'
          : input.browser || input.currentWeb
            ? 'sources'
            : input.localFile || input.shell || input.localApp
              ? 'local_action'
              : verificationRequired
                ? 'final_answer'
                : 'none',
  };
};

export function classifyUserIntent(instructions: string): SharedIntentDecision {
  const text = instructions.trim();
  const lower = text.toLowerCase();

  const simpleChat = !text || SIMPLE_CHAT_PATTERN.test(text);
  const wideResearch = WIDE_RESEARCH_PATTERN.test(text);
  const websiteBuild = WEBSITE_BUILD_PATTERN.test(text);
  const appDevelopment = APP_DEVELOPMENT_PATTERN.test(text) && !websiteBuild;
  const artifact = ARTIFACT_PATTERN.test(text);
  const slides = SLIDES_PATTERN.test(text);
  const design = DESIGN_PATTERN.test(text);
  const multimodal = MULTIMODAL_PATTERN.test(text);
  const connector = CONNECTOR_PATTERN.test(text);
  const scheduler = SCHEDULER_PATTERN.test(text);
  const shell = SHELL_PATTERN.test(text);
  const process = PROCESS_PATTERN.test(text) && shell;
  const localFile = LOCAL_FILE_PATTERN.test(text);
  const currentWeb =
    CURRENT_WEB_PATTERN.test(text) || RANKED_WEB_LIST_PATTERN.test(text);
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
    appDevelopment ||
    wideResearch ||
    artifact ||
    design ||
    multimodal ||
    connector ||
    scheduler ||
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
    connector,
    wideResearch,
    slides,
    design,
  };

  const contractFor = (taskType: SemanticTaskType) =>
    buildContract({
      taskType,
      browser,
      shell,
      localFile,
      localApp,
      websiteBuild,
      multimodal,
      connector,
      scheduler,
      artifact,
      slides,
      design,
      currentWeb,
      mixed,
      text,
    });

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
      contract: contractFor('answer'),
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
      contract: contractFor('conversation'),
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
      contract: contractFor('wide_research'),
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
      contract: contractFor('website_build'),
      signals,
    };
  }

  if (appDevelopment) {
    return {
      surface: 'computer',
      firstOperator: 'computer',
      kind: shell ? 'shell' : 'local_file',
      confidence: 0.9,
      reason: 'app development belongs to local workflow tools',
      contract: contractFor('app_development'),
      signals,
    };
  }

  if (connector || scheduler) {
    return {
      surface: 'computer',
      firstOperator: 'computer',
      kind: scheduler ? 'automation' : 'connector',
      confidence: 0.88,
      reason: 'connector or automation workflow needs configured tools and approvals',
      contract: contractFor(scheduler ? 'automation' : 'connector_workflow'),
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
      contract: contractFor(slides ? 'slide_creation' : 'artifact_creation'),
      signals,
    };
  }

  if (design && !browser) {
    return {
      surface: 'computer',
      firstOperator: 'computer',
      kind: multimodal ? 'multimodal' : 'artifact',
      confidence: 0.86,
      reason: 'design work should create or refine local artifacts',
      contract: contractFor('design_creation'),
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
      contract: contractFor('multimodal_creation'),
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
      contract: contractFor('mixed_workflow'),
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
      contract: contractFor('shell_or_process'),
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
      contract: contractFor('local_computer'),
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
      contract: contractFor('browser_operator'),
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
      contract: contractFor(direct ? 'answer' : 'conversation'),
      signals,
    };
  }

  return {
    surface: 'direct',
    firstOperator: 'computer',
    kind: 'direct_answer',
    confidence: 0.6,
    reason: 'no reliable automation signal detected',
    contract: contractFor('answer'),
    signals,
  };
}
