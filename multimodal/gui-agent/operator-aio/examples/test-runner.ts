/*
 * Copyright (c) 2025 Neura.
 * SPDX-License-Identifier: Apache-2.0
 */

import { AIOHybridOperator } from '../src/AIOHybridOperator';
import { StatusEnum } from '@neura-desktop/sdk';
// @ts-ignore - Module resolution issue: TypeScript cannot resolve this module with current 'Bundler' moduleResolution setting
// The type exists at '/node_modules/@neura-desktop/sdk/dist/core.d.ts' but requires 'node16', 'nodenext', or 'bundler' moduleResolution
import type { ExecuteParams } from '@neura-desktop/sdk/core';
import * as fs from 'fs';
import * as path from 'path';

// 配置真实的baseURL
// 在文件顶部添加
import 'dotenv/config';

const CONFIG = {
  baseURL: process.env.AIO_BASE_URL || 'http://localhost:8080', // 您的真实URL
  timeout: 10000,
};

async function testAIOHybridOperator() {
  console.log('🚀 开始测试 AIOHybridOperator...');
  console.log('配置:', CONFIG);

  try {
    // 1. 创建操作器实例
    console.log('\n📦 创建 AIOHybridOperator 实例...');
    const operator = await AIOHybridOperator.create(CONFIG);
    console.log('✅ 实例创建成功');

    // 2. 测试截图功能
    console.log('\n📸 测试截图功能...');
    const screenshot = await operator.screenshot();

    // 创建dumps目录
    const dumpsDir = path.join(__dirname, 'dumps');
    if (!fs.existsSync(dumpsDir)) {
      fs.mkdirSync(dumpsDir, { recursive: true });
    }

    // 保存截图
    if (screenshot.base64) {
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const filename = `screenshot-${timestamp}.png`;
      const filepath = path.join(dumpsDir, filename);

      // 将base64转换为buffer并保存
      const base64Data = screenshot.base64.replace(/^data:image\/png;base64,/, '');
      const buffer = Buffer.from(base64Data, 'base64');
      fs.writeFileSync(filepath, buffer);

      console.log('截图已保存:', filepath);
    }

    console.log('截图结果:', {
      base64Length: screenshot.base64?.length || 0,
      scaleFactor: screenshot.scaleFactor,
      hasBase64: !!screenshot.base64,
    });
    console.log('✅ 截图功能正常');

    // 3. 测试各种动作执行
    const testCases = [
      {
        name: '点击动作',
        params: {
          parsedPrediction: {
            action_type: 'click',
            action_inputs: {
              start_box: '[100, 200, 150, 250]',
            },
            reflection: '测试点击',
            thought: '执行点击操作',
            prediction: 'click action',
            factors: [1000, 1000],
          },
          screenWidth: 1920,
          screenHeight: 1080,
          scaleFactor: 1,
          prediction: 'click action',
          factors: [1000, 1000],
        } as ExecuteParams,
      },
      {
        name: '输入文本',
        params: {
          parsedPrediction: {
            action_type: 'type',
            action_inputs: {
              content: 'Hello World\n',
            },
            reflection: '测试输入',
            thought: '输入测试文本',
            prediction: 'type action',
            factors: [1000, 1000],
          },
          screenWidth: 1920,
          screenHeight: 1080,
          scaleFactor: 1,
          prediction: 'type action',
          factors: [1000, 1000],
        } as ExecuteParams,
      },
      {
        name: '快捷键',
        params: {
          parsedPrediction: {
            action_type: 'hotkey',
            action_inputs: {
              key: 'Ctrl+C',
            },
            reflection: '测试快捷键',
            thought: '执行复制快捷键',
            prediction: 'hotkey action',
            factors: [1000, 1000],
          },
          screenWidth: 1920,
          screenHeight: 1080,
          scaleFactor: 1,
          prediction: 'hotkey action',
          factors: [1000, 1000],
        } as ExecuteParams,
      },
      {
        name: '滚动操作',
        params: {
          parsedPrediction: {
            action_type: 'scroll',
            action_inputs: {
              start_box: '[500, 500, 600, 600]',
              direction: 'down',
            },
            reflection: '测试滚动',
            thought: '向下滚动',
            prediction: 'scroll action',
            factors: [1000, 1000],
          },
          screenWidth: 1920,
          screenHeight: 1080,
          scaleFactor: 1,
          prediction: 'scroll action',
          factors: [1000, 1000],
        } as ExecuteParams,
      },
      {
        name: '等待操作',
        params: {
          parsedPrediction: {
            action_type: 'wait',
            action_inputs: {},
            reflection: '测试等待',
            thought: '等待5秒',
            prediction: 'wait action',
            factors: [1000, 1000],
          },
          screenWidth: 1920,
          screenHeight: 1080,
          scaleFactor: 1,
          prediction: 'wait action',
          factors: [1000, 1000],
        } as ExecuteParams,
      },
    ];

    console.log('\n🎯 开始测试各种动作执行...');
    for (const testCase of testCases) {
      console.log(`\n测试: ${testCase.name}`);
      try {
        const result = await operator.execute(testCase.params);
        console.log('执行结果:', JSON.stringify(result));
        console.log(`✅ ${testCase.name} 执行成功`);
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.error(`❌ ${testCase.name} 执行失败:`, errorMessage);
      }
    }

    // 4. 验证动作空间定义
    console.log('\n📋 验证动作空间定义...');
    const actionSpaces = AIOHybridOperator.MANUAL.ACTION_SPACES;
    console.log('动作空间数量:', actionSpaces.length);
    console.log('动作空间列表:');
    actionSpaces.forEach((action, index) => {
      console.log(`  ${index + 1}. ${action}`);
    });
    console.log('✅ 动作空间验证完成');

    console.log('\n🎉 所有测试完成！');
  } catch (error) {
    console.error('❌ 测试过程中发生错误:', error);
    const errorStack = error instanceof Error ? error.stack : String(error);
    console.error('错误详情:', errorStack);
    process.exit(1);
  }
}

// 运行测试
if (require.main === module) {
  testAIOHybridOperator()
    .then(() => {
      console.log('\n✨ 测试脚本执行完成');
      process.exit(0);
    })
    .catch((error) => {
      console.error('\n💥 测试脚本执行失败:', error);
      process.exit(1);
    });
}

export { testAIOHybridOperator };
