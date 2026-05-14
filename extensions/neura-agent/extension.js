/**
 * Copyright (c) 2025 Neura.
 * SPDX-License-Identifier: Apache-2.0
 */
const vscode = require('vscode');

let provider;
let inlineProvider;
let statusBar;
let outputChannel;

const { NeuraComposerProvider } = require('./composerProvider');
const { NeuraInlineCompletionProvider } = require('./inlineCompletionProvider');
const { NeuraCodeLensProvider } = require('./codeLensProvider');
const { setOutputChannel, logNeura } = require('./utils');

const inputAndSend = async (mode, title, prompt) => {
  await provider?.setMode(mode);
  const content = await vscode.window.showInputBox({ title, prompt, ignoreFocusOut: true });
  if (content) {
    await provider?.sendPrompt(content, mode);
    await provider?.reveal();
  }
};

const pickBackgroundAgent = async (filter = () => true) => {
  const agents = (provider?.state?.backgroundAgents || []).filter(filter);
  if (!agents.length) throw new Error('No matching Neura background agent was found.');
  const picked = await vscode.window.showQuickPick(
    agents.map((agent) => ({
      label: agent.task,
      description: agent.status,
      detail: agent.branch || agent.path,
      agent,
    })),
    { title: 'Select Neura background agent', matchOnDescription: true, matchOnDetail: true },
  );
  return picked?.agent;
};

const wrap = (handler) => async () => {
  try {
    await handler();
  } catch (error) {
    await vscode.window.showErrorMessage(
      error instanceof Error ? error.message : 'Neura command failed.',
    );
  }
};

function activate(context) {
  outputChannel = vscode.window.createOutputChannel('Neura Composer');
  setOutputChannel(outputChannel);
  statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 90);
  statusBar.command = 'neura.openComposer';
  statusBar.text = '$(sparkle) Neura IDE';
  statusBar.show();
  logNeura('Extension activated');
  provider = new NeuraComposerProvider(context, statusBar);
  inlineProvider = new NeuraInlineCompletionProvider(() => provider?.config);
  const semanticWatcher = vscode.workspace.createFileSystemWatcher(
    '**/*.{js,jsx,ts,tsx,mjs,cjs,json,html,css,md,py,rs,go,java,cs,php,rb,yml,yaml,toml,sql,sh,ps1}',
  );
  context.subscriptions.push(
    statusBar,
    outputChannel,
    provider.proposalDecoration,
    semanticWatcher,
    vscode.languages.registerInlineCompletionItemProvider({ pattern: '**' }, inlineProvider),
    vscode.languages.registerCodeLensProvider(
      { scheme: 'file' },
      new NeuraCodeLensProvider((document) => provider?.hasPendingProposalForDocument(document)),
    ),
    vscode.window.registerWebviewViewProvider('neura-ai.chat', provider, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
    vscode.commands.registerCommand('neura.openAiPanel', wrap(() => provider.reveal())),
    vscode.commands.registerCommand('neura.openComposer', wrap(() => provider.reveal())),
    vscode.commands.registerCommand('neura.ask', wrap(() => inputAndSend('ask', 'Neura: Explain Code', 'Ask about code, errors, architecture, or project files.'))),
    vscode.commands.registerCommand('neura.generatePlan', wrap(() => inputAndSend('plan', 'Neura: Generate Plan', 'Describe the coding change Neura should plan.'))),
    vscode.commands.registerCommand('neura.runAgent', wrap(() => inputAndSend('agent', 'Neura: Edit Code', 'Describe the code change Neura should implement.'))),
    vscode.commands.registerCommand('neura.buildApp', wrap(() => inputAndSend('builder', 'Neura: Build App', 'Describe the website, app, page, or feature Neura should build.'))),
    vscode.commands.registerCommand('neura.editSelection', wrap(() => provider.editSelectionFromEditor())),
    vscode.commands.registerCommand('neura.explainCurrentFile', wrap(() => provider.explainCurrentFile())),
    vscode.commands.registerCommand('neura.reviewCurrentFileProposal', wrap(() => provider.reviewCurrentFileProposal())),
    vscode.commands.registerCommand('neura.acceptCurrentFileHunk', wrap(() => provider.acceptCurrentFileHunk())),
    vscode.commands.registerCommand('neura.rejectCurrentFileHunk', wrap(() => provider.rejectCurrentFileHunk())),
    vscode.commands.registerCommand('neura.continueTrajectory', wrap(() => provider.continueStoppedTrajectory())),
    vscode.commands.registerCommand('neura.applyChanges', wrap(async () => {
      const proposal = provider.state.proposals.find((item) => item.status === 'proposed' || item.status === 'partially_applied');
      if (!proposal) throw new Error('No pending Neura change proposal was found.');
      await provider.applyProposal(proposal.id);
    })),
    vscode.commands.registerCommand('neura.restoreCheckpoint', wrap(async () => {
      const checkpoint = provider.state.checkpoints[0];
      if (!checkpoint) throw new Error('No Neura checkpoint was found.');
      await provider.restoreCheckpoint(checkpoint.id);
    })),
    vscode.commands.registerCommand('neura.openPreview', wrap(async () => {
      const proposal = provider.state.proposals.find((item) => item.preview);
      await provider.openPreview(proposal?.id);
    })),
    vscode.commands.registerCommand('neura.verifyPreview', wrap(async () => {
      const proposal = provider.state.proposals.find((item) => item.preview);
      await provider.verifyPreview(proposal?.id);
    })),
    vscode.commands.registerCommand('neura.rebuildSemanticIndex', wrap(() => provider.rebuildSemanticIndex())),
    vscode.commands.registerCommand('neura.exportProofBundle', wrap(() => provider.exportProofBundle())),
    vscode.commands.registerCommand('neura.newMcpToolCard', wrap(() => provider.promptMcpToolCall())),
    vscode.commands.registerCommand('neura.runApprovedCommand', wrap(async () => {
      const command = await vscode.window.showInputBox({
        title: 'Neura: Run Command',
        prompt: 'Command to run in the current workspace after confirmation.',
        ignoreFocusOut: true,
      });
      if (command) await provider.runCommand(undefined, undefined, command);
    })),
    vscode.commands.registerCommand('neura.addWorktree', wrap(() => provider.addWorktree())),
    vscode.commands.registerCommand('neura.createBackgroundAgent', wrap(() => provider.createBackgroundAgent())),
    vscode.commands.registerCommand('neura.followUpBackgroundAgent', wrap(async () => {
      const agent = await pickBackgroundAgent();
      if (agent) await provider.followUpBackgroundAgent(agent.id);
    })),
    vscode.commands.registerCommand('neura.reviewBackgroundAgent', wrap(async () => {
      const agent = await pickBackgroundAgent((item) => ['completed', 'failed', 'cancelled', 'interrupted'].includes(item.status));
      if (agent) await provider.createBackgroundAgentReview(agent.id);
    })),
    vscode.commands.registerCommand('neura.cancelBackgroundAgent', wrap(async () => {
      const agent = await pickBackgroundAgent((item) => ['queued', 'running'].includes(item.status));
      if (agent) await provider.cancelBackgroundAgent(agent.id);
    })),
    vscode.commands.registerCommand('neura.installPlugin', wrap(() => provider.installPlugin())),
    vscode.commands.registerCommand('neura.toggleInlineCompletions', wrap(() => provider.toggleInlineCompletions())),
    vscode.commands.registerCommand('neura.syncCanvasProject', wrap(() => provider.refresh())),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration('neura')) {
        void provider.refresh();
      }
    }),
    vscode.window.onDidChangeActiveTextEditor((editor) => {
      provider?.refreshInlineProposalDecorations(editor);
    }),
    vscode.workspace.onDidSaveTextDocument(() => {
      provider?.scheduleSemanticIndexUpdate('save');
    }),
    semanticWatcher.onDidCreate(() => {
      provider?.scheduleSemanticIndexUpdate('create');
    }),
    semanticWatcher.onDidChange(() => {
      provider?.scheduleSemanticIndexUpdate('change');
    }),
    semanticWatcher.onDidDelete(() => {
      provider?.scheduleSemanticIndexUpdate('delete');
    }),
  );

  setTimeout(() => {
    void provider.reveal();
  }, 500);
}

function deactivate() {
  logNeura('Extension deactivated');
  if (provider?.semanticIndexTimer) clearTimeout(provider.semanticIndexTimer);
  for (const run of provider?.backgroundRuns?.values?.() || []) {
    void run.catch(() => {});
  }
  for (const client of provider?.mcpClients?.values?.() || []) {
    client.dispose();
  }
  statusBar?.dispose();
  outputChannel?.dispose();
}

module.exports = { activate, deactivate };
