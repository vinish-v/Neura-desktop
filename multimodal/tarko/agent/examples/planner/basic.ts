/**
 * Copyright (c) 2025 Neura.
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Example implementing a Planner Agent that uses Plan-and-solve methodology
 * This agent first creates a plan of steps, then executes and updates them
 */

import {
  Agent,
  AgentOptions,
  AgentEventStream,
  AgentRunNonStreamingOptions,
  LogLevel,
  Tool,
  z,
} from '../../src';
import { BrowserSearch } from '@agent-infra/browser-search';
import { ConsoleLogger } from '@tarko/shared-utils';
import { LocalBrowser } from '@agent-infra/browser';
import { READABILITY_SCRIPT, toMarkdown } from '@agent-infra/shared';

/**
 * PlannerAgent - Extends the base Agent to implement a Plan-and-solve pattern
 *
 * This agent follows this workflow:
 * 1. Generate an initial plan with steps
 * 2. Before each agent loop, reflect on current progress and update the plan
 * 3. Execute tools as needed to complete plan steps
 * 4. Provide a final summary when all steps are complete
 */
class PlannerAgent extends Agent {
  private currentPlan: AgentEventStream.PlanStep[] = [];
  private taskCompleted = false;

  constructor(options: AgentOptions) {
    super({
      ...options,
      instructions: `${options.instructions || ''}

You are a methodical agent that follows a plan-and-solve approach. First create a plan with steps, then execute each step in order. As you work:
1. Update the plan as you learn new information
2. Mark steps as completed when they are done

3. When ALL steps are complete, call the "final_answer" tool to generate a comprehensive final report

IMPORTANT CONSTRAINTS:
- Create AT MOST 3 key steps in your plan
- Focus ONLY on information gathering and research steps
- DO NOT include report creation as a step (the "final_answer" tool will handle this)

The plan data structure consists of an array of steps, where each step must have:
- "content": A detailed description of what needs to be done
- "done": A boolean flag indicating completion status (true/false)

IMPORTANT: You must ALWAYS call the "final_answer" tool once ALL plan steps are complete. This tool will generate the final comprehensive report based on all the information gathered. Do not try to create the final report yourself.`,
    });

    // Register the final report tool
    this.registerTool(
      new Tool({
        id: 'final_answer',
        description: 'Generate a comprehensive final report after all plan steps are completed',
        parameters: z.object({}),
        function: async () => {
          return this.generatefinalAnswer();
        },
      }),
    );
  }

  /**
   * Initializes the agent with required tools and setup
   */
  override async initialize(): Promise<void> {
    await super.initialize();
  }

  /**
   * Hook called at the beginning of each agent loop iteration
   * Used to update the plan before each loop
   */
  override async onEachAgentLoopStart(sessionId: string): Promise<void> {
    await super.onEachAgentLoopStart(sessionId);

    if (this.taskCompleted) {
      return;
    }

    // In the first iteration, create an initial plan
    if (this.getCurrentLoopIteration() === 1) {
      await this.generateInitialPlan(sessionId);
    } else {
      // In subsequent iterations, update the plan
      await this.updatePlan(sessionId);
    }
  }

  private getLLMClientAndAgentModel() {
    const agentModel = this.getCurrentModel()!;
    const llmClient = this.getLLMClient()!;
    return { agentModel, llmClient };
  }

  /**
   * Generates the initial plan
   */
  private async generateInitialPlan(sessionId: string): Promise<void> {
    // Create plan start event
    const startEvent = this.getEventStream().createEvent('plan_start', {
      sessionId,
    });
    this.getEventStream().sendEvent(startEvent);
    const { llmClient, agentModel } = this.getLLMClientAndAgentModel();

    // Get messages from event stream to understand the task
    const messages = this.getMessages();

    try {
      // Request the LLM to create an initial plan with steps
      const response = await llmClient.chat.completions.create({
        model: agentModel.id,
        response_format: { type: 'json_object' },
        messages: [
          ...messages,
          {
            role: 'user',
            content:
              "Create a step-by-step plan to complete the user's request. " +
              'Return a JSON object with an array of steps. Each step should have a "content" field ' +
              'describing what needs to be done and a "done" field set to false.\n\n' +
              'IMPORTANT CONSTRAINTS:\n' +
              '- Create AT MOST 3 key steps in your plan\n' +
              '- Focus ONLY on information gathering and research steps\n' +
              '- DO NOT include report creation as a step (the "final_answer" tool will handle this)',
          },
        ],
      });

      // Parse the response
      const content = response.choices[0]?.message?.content || '{"steps":[]}';
      let planData;
      try {
        planData = JSON.parse(content);
      } catch (e) {
        this.logger.error(`Failed to parse plan JSON: ${e}`);
        planData = { steps: [] };
      }

      // Store the plan
      this.currentPlan = Array.isArray(planData.steps)
        ? planData.steps.map((step: any) => ({
            content: step.content || 'Unknown step',
            done: false,
          }))
        : [];

      // Send plan update event
      const updateEvent = this.getEventStream().createEvent('plan_update', {
        sessionId,
        steps: this.currentPlan,
      });
      this.getEventStream().sendEvent(updateEvent);

      // Send a system event for better visibility
      const systemEvent = this.getEventStream().createEvent('system', {
        level: 'info',
        message: `Initial plan created with ${this.currentPlan.length} steps`,
        details: { plan: this.currentPlan },
      });
      this.getEventStream().sendEvent(systemEvent);
    } catch (error) {
      this.logger.error(`Error generating initial plan: ${error}`);

      // Create a minimal default plan if generation fails
      this.currentPlan = [{ content: 'Complete the task', done: false }];

      const updateEvent = this.getEventStream().createEvent('plan_update', {
        sessionId,
        steps: this.currentPlan,
      });
      this.getEventStream().sendEvent(updateEvent);
    }
  }

  /**
   * Updates the plan based on current progress
   */
  private async updatePlan(sessionId: string): Promise<void> {
    // Get the current conversation context
    const messages = this.getMessages();
    const { llmClient, agentModel } = this.getLLMClientAndAgentModel();

    try {
      // Request the LLM to evaluate and update the plan
      const response = await llmClient.chat.completions.create({
        model: agentModel.id,
        response_format: { type: 'json_object' },
        messages: [
          ...messages,
          {
            role: 'system',
            content:
              'Evaluate the current progress and update the plan. ' +
              'Return a JSON object with an array of steps, marking completed steps as "done": true. ' +
              'Add new steps if needed. If all steps are complete, include a "completed": true field ' +
              'and a "summary" field with a final summary.\n\n' +
              'IMPORTANT CONSTRAINTS:\n' +
              '- Create AT MOST 3 key steps in your plan\n' +
              '- Focus ONLY on information gathering and research steps\n' +
              '- DO NOT include report creation as a step (the "final_answer" tool will handle this)',
          },
          {
            role: 'system',
            content: `Current plan: ${JSON.stringify({ steps: this.currentPlan })}`,
          },
        ],
      });

      // Parse the response
      const content = response.choices[0]?.message?.content || '{"steps":[]}';
      let planData;
      try {
        planData = JSON.parse(content);
      } catch (e) {
        this.logger.error(`Failed to parse plan update JSON: ${e}`);
        planData = { steps: this.currentPlan };
      }

      // Update the plan
      if (Array.isArray(planData.steps)) {
        this.currentPlan = planData.steps.map((step: any) => ({
          content: step.content || 'Unknown step',
          done: Boolean(step.done),
        }));
      }

      // Send plan update event
      const updateEvent = this.getEventStream().createEvent('plan_update', {
        sessionId,
        steps: this.currentPlan,
      });
      this.getEventStream().sendEvent(updateEvent);

      // Check if the plan is completed
      const allStepsDone = this.currentPlan.every((step) => step.done);
      this.taskCompleted = allStepsDone && Boolean(planData.completed);

      if (this.taskCompleted) {
        // Send plan finish event
        const finishEvent = this.getEventStream().createEvent('plan_finish', {
          sessionId,
          summary: planData.summary || 'Task completed successfully',
        });
        this.getEventStream().sendEvent(finishEvent);
      }
    } catch (error) {
      this.logger.error(`Error updating plan: ${error}`);
    }
  }

  /**
   * Generates a comprehensive final report based on all collected information
   * This method is called by the "final_answer" tool and triggers loop termination
   */
  private async generatefinalAnswer(): Promise<string> {
    this.logger.info('Generating final comprehensive report');

    // Request loop termination to allow proper completion
    this.requestLoopTermination();

    const { llmClient, agentModel } = this.getLLMClientAndAgentModel();

    // Get all events for context
    const events = this.getEventStream().getEvents();

    // Create a summary of the events for the report generation
    const userMessages = events.filter((e) => e.type === 'user_message');
    const toolResults = events.filter((e) => e.type === 'tool_result');

    try {
      // Request the LLM to create a comprehensive report
      const response = await llmClient.chat.completions.create({
        model: agentModel.id,
        temperature: 0.3, // Lower temperature for more factual reports
        messages: [
          {
            role: 'system',
            content:
              '你是一个专业的研究报告生成器。根据提供的所有信息，生成一份全面、详细且结构清晰的研究报告。' +
              '报告应该包含详细的分析、洞见，并引用所有相关的事实和数据。' +
              '使用专业的语言和格式，包括标题、小标题、要点和总结。' +
              '确保报告全面覆盖了所有已收集的重要信息。',
          },
          {
            role: 'user',
            content:
              '用户的原始查询是：' +
              (typeof userMessages[0]?.content === 'string'
                ? userMessages[0].content
                : 'Unknown query') +
              '\n\n以下是我们收集到的所有信息：\n\n' +
              toolResults
                .map((result) => {
                  const r = result as AgentEventStream.ToolResultEvent;
                  return `来自工具 ${r.name} 的结果:\n${JSON.stringify(r.content, null, 2)}\n\n`;
                })
                .join('\n') +
              '\n\n请基于以上所有信息生成一份全面、详细的研究报告，确保包含所有重要的数据点和见解。',
          },
        ],
        max_tokens: 10000, // Allow for a detailed report
      });

      const report = response.choices[0]?.message?.content || '无法生成报告';

      // Send a system event with the report
      const systemEvent = this.getEventStream().createEvent('system', {
        level: 'info',
        message: '最终报告已生成',
        details: { report },
      });
      this.getEventStream().sendEvent(systemEvent);

      // Send plan finish event with the report as summary
      const finishEvent = this.getEventStream().createEvent('plan_finish', {
        sessionId: 'final-report',
        summary: report,
      });
      this.getEventStream().sendEvent(finishEvent);

      return report;
    } catch (error) {
      this.logger.error(`Error generating final report: ${error}`);
      return `生成最终报告时出错: ${error}`;
    }
  }

  /**
   * Get messages for planning context
   */
  private getMessages(): any[] {
    // Get only user and assistant messages to avoid overwhelming the context
    const events = this.getEventStream().getEventsByType(['user_message', 'assistant_message']);

    // Convert events to message format
    return events.map((event) => {
      if (event.type === 'user_message') {
        return {
          role: 'user',
          content:
            typeof event.content === 'string' ? event.content : JSON.stringify(event.content),
        };
      } else {
        return {
          role: 'assistant',
          content: event.content,
        };
      }
    });
  }
}

/**
 * VisitLink Tool - Opens a specific URL and extracts content
 * This tool visits a web page and returns its content in Markdown format
 */
const VisitLinkTool = new Tool({
  id: 'visit-link',
  description: 'Visit a specific web page and extract its content in readable format',
  parameters: z.object({
    url: z.string().describe('The URL to visit and extract content from'),
    waitForSelector: z
      .string()
      .optional()
      .describe('Optional CSS selector to wait for before extraction'),
  }),
  function: async ({ url, waitForSelector }) => {
    console.log(`Visiting URL: "${url}"`);

    // Create logger for the browser
    const logger = new ConsoleLogger('[VisitLink]');

    // Initialize the browser
    const browser = new LocalBrowser({ logger });

    try {
      // Launch browser in headless mode for speed
      await browser.launch({ headless: true });

      // Extract content using Readability
      const result = await browser.evaluateOnNewPage({
        url,
        waitForOptions: { waitUntil: 'networkidle2' },
        pageFunction: (window, readabilityScript) => {
          // Wait for selector if provided
          const document = window.document;

          // Use Mozilla's Readability library to extract clean content
          const Readability = new Function('module', `${readabilityScript}\nreturn module.exports`)(
            {},
          );

          // Clean up page by removing scripts and other non-content elements
          document
            .querySelectorAll('script,noscript,style,link,iframe,canvas,svg[width="0"]')
            .forEach((el) => el.remove());

          // Parse content
          const article = new Readability(document).parse();

          return {
            title: article?.title || document.title,
            content: article?.content || document.body.innerHTML,
            url: window.location.href,
            excerpt: article?.excerpt || '',
          };
        },
        pageFunctionParams: [READABILITY_SCRIPT],
        beforePageLoad: async (page) => {
          // Set a reasonable viewport
          await page.setViewport({ width: 1280, height: 800 });

          // Set user agent to avoid being blocked
          await page.setUserAgent(
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
          );
        },
        afterPageLoad: async (page) => {
          // Wait for specific selector if provided
          if (waitForSelector) {
            try {
              await page.waitForSelector(waitForSelector, { timeout: 5000 });
            } catch (e) {
              logger.warn(`Selector "${waitForSelector}" not found, continuing anyway`);
            }
          }

          // Wait a bit for dynamic content to load
          await new Promise((resolve) => setTimeout(resolve, 1000));
        },
      });

      if (!result) {
        return {
          error: 'Failed to extract content from page',
          url,
        };
      }

      // Convert HTML content to Markdown
      const markdownContent = toMarkdown(result.content);

      return {
        title: result.title,
        url: result.url,
        excerpt: result.excerpt,
        content:
          markdownContent.substring(0, 8000) +
          (markdownContent.length > 8000 ? '...(content trimmed)' : ''),
      };
    } catch (error) {
      logger.error(`Error visiting URL: ${error}`);
      return {
        error: `Failed to visit URL: ${error}`,
        url,
      };
    } finally {
      // Always close the browser to free resources
      await browser.close();
    }
  },
});

/**
 * Search Tool - Uses real browser-based search
 * This tool performs actual web searches and extracts content from result pages
 */
const SearchTool = new Tool({
  id: 'web-search',
  description: 'Perform a comprehensive web search on a topic and extract detailed information',
  parameters: z.object({
    query: z.string().describe('The search query to research'),
    count: z.number().optional().describe('Number of results to fetch (default: 3)'),
    engine: z
      .enum(['google', 'bing', 'baidu'])
      .optional()
      .describe('Search engine to use (default: google)'),
  }),
  function: async ({ query, count = 3, engine = 'google' }) => {
    console.log(`Performing deep research on: "${query}" using ${engine} search engine`);

    // Create logger for the search
    const logger = new ConsoleLogger('[DeepResearch]');

    // Initialize the browser search client
    const browserSearch = new BrowserSearch({
      logger,
      browserOptions: {
        headless: true, // Run in headless mode
      },
    });

    try {
      // Perform the search
      const results = await browserSearch.perform({
        query: query as string,
        count: count as number,
        engine,
        needVisitedUrls: true, // Extract content from pages
      });

      console.log(`Found ${results.length} results for "${query}"`);

      // Process results to make them more useful for the agent
      const processedResults = results.map((result, index) => {
        // Trim content to a reasonable length to avoid overwhelming the model
        const maxContentLength = 1000;
        const trimmedContent =
          result.content.length > maxContentLength
            ? result.content.substring(0, maxContentLength) + '...(content trimmed)'
            : result.content;

        return {
          index: index + 1,
          title: result.title,
          url: result.url,
          content: trimmedContent,
        };
      });

      return {
        query,
        engine,
        totalResults: results.length,
        results: processedResults,
      };
    } catch (error) {
      logger.error(`Error in deep research: ${error}`);
      return {
        error: `Failed to perform research: ${error}`,
        query,
      };
    } finally {
      // Always close the browser to free resources
      await browserSearch.closeBrowser();
    }
  },
});

// Export the agent and runOptions for testing
export const agent = new PlannerAgent({
  name: 'Plan-and-Solve Agent',

  tools: [SearchTool, VisitLinkTool],
  logLevel: LogLevel.INFO,
  model: {
    provider: 'volcengine',
    id: 'doubao-seed-1-6-vision-250815',
    apiKey: process.env.ARK_API_KEY,
  },
  maxIterations: 100,
  toolCallEngine: 'structured_outputs',
});

export const runOptions: AgentRunNonStreamingOptions = {
  input: `帮我调研一下 ByteDance 的开源项目，给出一份完整的报告

我期待覆盖的信息： 
1. 主要的开源项目、贡献者；
2. 应用场景； 


要求报告输出中文。`,
};

// Main function for running the example
async function main() {
  // Check for command line arguments
  const userQuery = process.argv[2] || runOptions.input;

  await agent.initialize();

  console.log('\n🤖 Running Planner Agent');
  console.log('--------------------------------------------');
  console.log(`Query: "${userQuery}"`);
  console.log('--------------------------------------------');

  // Subscribe to plan events

  const unsubscribe = agent
    .getEventStream()
    .subscribeToTypes(
      ['plan_start', 'plan_update', 'plan_finish'],
      (event: AgentEventStream.Event) => {
        if (event.type === 'plan_start') {
          console.log('\n📝 Plan started');
          console.log('--------------------------------------------');
        } else if (event.type === 'plan_update') {
          const planEvent = event as any;
          console.log('\n📋 Plan updated:');
          console.log('--------------------------------------------');
          planEvent.steps.forEach((step: AgentEventStream.PlanStep, index: number) => {
            console.log(`  ${index + 1}. [${step.done ? '✓' : ' '}] ${step.content}`);
          });
          console.log('--------------------------------------------');
        } else if (event.type === 'plan_finish') {
          const planEvent = event as any;
          console.log('\n🎉 Plan finished!');
          console.log('--------------------------------------------');
          console.log(`Summary: ${planEvent.summary}`);
          console.log('--------------------------------------------');
        }
      },
    );

  // Also subscribe to tool events for better visibility

  const toolUnsubscribe = agent
    .getEventStream()
    .subscribeToTypes(['tool_call', 'tool_result'], (event: AgentEventStream.Event) => {
      if (event.type === 'tool_call') {
        const toolEvent = event;
        console.log(`\n🔧 Using tool: ${toolEvent.name}`);
      } else if (event.type === 'tool_result') {
        const resultEvent = event;
        console.log(`✅ Tool result: ${JSON.stringify(resultEvent.content)}`);
      }
    });

  // Run the agent with the specified query
  const result = await agent.run({
    ...runOptions,
    input: userQuery,
  });

  console.log('\n🤖 Final response:');
  console.log('--------------------------------------------');
  console.log(result.content);
  console.log('--------------------------------------------');

  // Clean up subscriptions
  unsubscribe();
  toolUnsubscribe();
}

if (require.main === module) {
  main().catch(console.error);
}
