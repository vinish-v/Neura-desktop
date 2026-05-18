/**
 * Copyright (c) 2025 Neura.
 * SPDX-License-Identifier: Apache-2.0
 */

export type NativeToolDomain =
  | 'computer'
  | 'browser'
  | 'files'
  | 'documents'
  | 'processes'
  | 'monitoring'
  | 'connectors'
  | 'multimodal'
  | 'website';

export type NativeToolDefinition = {
  name: string;
  label: string;
  domain: NativeToolDomain;
  actionSpace: string;
  description: string;
};

export const NATIVE_COMPUTER_TOOLS: NativeToolDefinition[] = [
  {
    name: 'read_file',
    label: 'Read File',
    domain: 'files',
    actionSpace: "read_file(path='')",
    description: 'Read text, PDF, DOCX, JSON, CSV, or other local files.',
  },
  {
    name: 'write_file',
    label: 'Write File',
    domain: 'files',
    actionSpace: "write_file(path='', content='', overwrite='false')",
    description:
      'Create a local text/markdown/code file. Does not overwrite by default.',
  },
  {
    name: 'edit_file',
    label: 'Edit File',
    domain: 'files',
    actionSpace: "edit_file(path='', query='', content='')",
    description: 'Replace exact text in an existing local file.',
  },
  {
    name: 'list_dir',
    label: 'List Folder',
    domain: 'files',
    actionSpace: "list_dir(path='')",
    description: 'List files and folders in a directory.',
  },
  {
    name: 'file_info',
    label: 'File Info',
    domain: 'files',
    actionSpace: "file_info(path='')",
    description: 'Get size, type, and modified time for a file or folder.',
  },
  {
    name: 'create_folder',
    label: 'Create Folder',
    domain: 'files',
    actionSpace: "create_folder(path='')",
    description: 'Create a new folder safely.',
  },
  {
    name: 'copy_file',
    label: 'Copy File',
    domain: 'files',
    actionSpace: "copy_file(path='', output_path='', overwrite='false')",
    description: 'Copy a file or folder. Does not overwrite by default.',
  },
  {
    name: 'move_file',
    label: 'Move File',
    domain: 'files',
    actionSpace: "move_file(path='', output_path='', overwrite='false')",
    description: 'Move or rename a file/folder. Does not overwrite by default.',
  },
  {
    name: 'zip_files',
    label: 'Zip Files',
    domain: 'files',
    actionSpace: "zip_files(paths='', output_path='', overwrite='false')",
    description: "Create a zip archive. Separate multiple paths with ';'.",
  },
  {
    name: 'unzip_file',
    label: 'Unzip File',
    domain: 'files',
    actionSpace: "unzip_file(path='', output_path='', overwrite='false')",
    description: 'Extract a zip archive to a folder.',
  },
  {
    name: 'create_docx',
    label: 'Create Word Doc',
    domain: 'documents',
    actionSpace: "create_docx(path='', content='', overwrite='false')",
    description: 'Create a Word document from text or markdown-like content.',
  },
  {
    name: 'create_pdf',
    label: 'Create PDF',
    domain: 'documents',
    actionSpace: "create_pdf(path='', content='', overwrite='false')",
    description: 'Create a PDF report from text content.',
  },
  {
    name: 'create_xlsx',
    label: 'Create Spreadsheet',
    domain: 'documents',
    actionSpace: "create_xlsx(path='', content='', overwrite='false')",
    description:
      'Create an Excel workbook from CSV, TSV, JSON rows, or plain text.',
  },
  {
    name: 'create_pptx',
    label: 'Create Slides',
    domain: 'documents',
    actionSpace:
      "create_pptx(path='', content='', image_path='', overwrite='false')",
    description:
      'Create a PowerPoint deck from slide text separated by ---. Optionally embed an image artifact on the first slide.',
  },
  {
    name: 'start_process',
    label: 'Start Process',
    domain: 'processes',
    actionSpace: "start_process(command='', cwd='')",
    description:
      'Start a long-running command/server without blocking the agent loop.',
  },
  {
    name: 'read_process',
    label: 'Read Process',
    domain: 'processes',
    actionSpace: "read_process(process_id='')",
    description: 'Read buffered stdout/stderr for a Neura-started process.',
  },
  {
    name: 'stop_process',
    label: 'Stop Process',
    domain: 'processes',
    actionSpace: "stop_process(process_id='')",
    description: 'Stop a process that Neura started.',
  },
  {
    name: 'list_processes',
    label: 'List Processes',
    domain: 'processes',
    actionSpace: 'list_processes()',
    description: 'List processes started by Neura.',
  },
  {
    name: 'create_monitor',
    label: 'Create Monitor',
    domain: 'monitoring',
    actionSpace:
      "create_monitor(url='', interval_minutes='5', watch='page', query='', notify_on='change')",
    description:
      'Create an in-app webpage monitor that checks for changes while Neura is open.',
  },
  {
    name: 'list_monitors',
    label: 'List Monitors',
    domain: 'monitoring',
    actionSpace: 'list_monitors()',
    description: 'List active webpage monitors.',
  },
  {
    name: 'stop_monitor',
    label: 'Stop Monitor',
    domain: 'monitoring',
    actionSpace: "stop_monitor(monitor_id='')",
    description: 'Stop an active webpage monitor.',
  },
  {
    name: 'create_website_project',
    label: 'Create Website Project',
    domain: 'website',
    actionSpace:
      "create_website_project(path='', title='', prompt='', asset_path='', overwrite='false')",
    description:
      'Create a local Vite React TypeScript website starter project. Optionally copy an image/audio/video artifact into the app.',
  },
  {
    name: 'start_website_preview',
    label: 'Start Website Preview',
    domain: 'website',
    actionSpace: "start_website_preview(path='', install='false')",
    description:
      'Start npm run dev for a local website project. Optionally install dependencies first.',
  },
  {
    name: 'export_website_project',
    label: 'Export Website Project',
    domain: 'website',
    actionSpace:
      "export_website_project(path='', output_path='', overwrite='false')",
    description: 'Zip a local website project for static handoff.',
  },
  {
    name: 'check_multimodal_readiness',
    label: 'Check Multimodal Readiness',
    domain: 'multimodal',
    actionSpace: 'check_multimodal_readiness()',
    description:
      'Report which optional media providers are configured before trying image, audio, or video tools.',
  },
  {
    name: 'generate_image',
    label: 'Generate Image',
    domain: 'multimodal',
    actionSpace: "generate_image(path='', prompt='', overwrite='false')",
    description: 'Generate an image artifact with a configured image provider.',
  },
  {
    name: 'transcribe_audio',
    label: 'Transcribe Audio',
    domain: 'multimodal',
    actionSpace: "transcribe_audio(path='', output_path='', overwrite='false')",
    description:
      'Transcribe an audio file with the configured speech-to-text provider.',
  },
  {
    name: 'synthesize_speech',
    label: 'Synthesize Speech',
    domain: 'multimodal',
    actionSpace:
      "synthesize_speech(path='', text='', voice='', overwrite='false')",
    description:
      'Create speech output with the configured text-to-speech provider.',
  },
  {
    name: 'analyze_video',
    label: 'Analyze Video',
    domain: 'multimodal',
    actionSpace:
      "analyze_video(path='', output_path='', prompt='', overwrite='false')",
    description:
      'Analyze a video with the configured video understanding provider.',
  },
  {
    name: 'list_connectors',
    label: 'List Connectors',
    domain: 'connectors',
    actionSpace: 'list_connectors()',
    description: 'List local connector registry status and enabled tools.',
  },
  {
    name: 'connector_github_issue',
    label: 'Create GitHub Issue',
    domain: 'connectors',
    actionSpace: "connector_github_issue(repository='', title='', message='')",
    description:
      'Create an issue in an enabled GitHub connector repository after user approval.',
  },
  {
    name: 'connector_github_export',
    label: 'Export To GitHub',
    domain: 'connectors',
    actionSpace:
      "connector_github_export(repository='', path='', target_path='', message='')",
    description:
      'Commit a local file to a GitHub repository path through the enabled GitHub connector after user approval.',
  },
  {
    name: 'connector_slack_post',
    label: 'Post To Slack',
    domain: 'connectors',
    actionSpace: "connector_slack_post(message='')",
    description: 'Post a message through the enabled Slack webhook connector.',
  },
  {
    name: 'connector_drive_export',
    label: 'Drive Export',
    domain: 'connectors',
    actionSpace: "connector_drive_export(path='')",
    description:
      'Prepare a Google Drive-compatible export placeholder for a local file.',
  },
  {
    name: 'connector_mcp_call',
    label: 'Call MCP Connector',
    domain: 'connectors',
    actionSpace: "connector_mcp_call(tool='', payload='')",
    description:
      'Call a configured custom MCP connector placeholder. Full MCP runtime execution is handled in the connector phase.',
  },
];

export const NATIVE_BROWSER_TOOLS: NativeToolDefinition[] = [
  {
    name: 'extract_page',
    label: 'Extract Page',
    domain: 'browser',
    actionSpace: "extract_page(format='markdown')",
    description:
      'Extract current browser page as markdown, text, html, links, tables, or json.',
  },
  {
    name: 'download_url',
    label: 'Download URL',
    domain: 'browser',
    actionSpace: "download_url(url='', output_path='', overwrite='false')",
    description: 'Download a URL to a local file.',
  },
  {
    name: 'save_page_screenshot',
    label: 'Save Screenshot',
    domain: 'browser',
    actionSpace:
      "save_page_screenshot(path='', full_page='false', overwrite='false')",
    description:
      'Save the current browser page screenshot to a local image file.',
  },
];

export const NATIVE_TOOLS = [
  ...NATIVE_COMPUTER_TOOLS,
  ...NATIVE_BROWSER_TOOLS,
] as const;

export const getNativeToolLabel = (actionType: string) =>
  NATIVE_TOOLS.find((tool) => tool.name === actionType)?.label ||
  actionType.replace(/_/g, ' ');

export const nativeToolPrompt = (tools: NativeToolDefinition[]) =>
  tools.map((tool) => `${tool.actionSpace} # ${tool.description}`).join('\n');
