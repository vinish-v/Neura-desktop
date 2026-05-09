/**
 * Copyright (c) 2025 Neura.
 * SPDX-License-Identifier: Apache-2.0
 */
import { Image, Mic, Video } from 'lucide-react';

import { useSetting } from '@renderer/hooks/useSetting';
import { Input } from '@renderer/components/ui/input';
import { Label } from '@renderer/components/ui/label';

type ProviderKey = 'image' | 'speechToText' | 'textToSpeech' | 'video';

const providers: Array<{
  key: ProviderKey;
  title: string;
  icon: typeof Image;
  fields: Array<'baseUrl' | 'apiKey' | 'model' | 'voice'>;
}> = [
  {
    key: 'image',
    title: 'Image Generation',
    icon: Image,
    fields: ['baseUrl', 'apiKey', 'model'],
  },
  {
    key: 'speechToText',
    title: 'Speech To Text',
    icon: Mic,
    fields: ['baseUrl', 'apiKey', 'model'],
  },
  {
    key: 'textToSpeech',
    title: 'Text To Speech',
    icon: Mic,
    fields: ['baseUrl', 'apiKey', 'model', 'voice'],
  },
  {
    key: 'video',
    title: 'Video Understanding',
    icon: Video,
    fields: ['baseUrl', 'apiKey', 'model'],
  },
];

const labels = {
  baseUrl: 'Base URL',
  apiKey: 'API Key',
  model: 'Model',
  voice: 'Voice',
};

export function MultimodalSettings() {
  const { settings, updateSetting } = useSetting();
  const multimodalProviders = settings.multimodalProviders || {};

  const updateProvider = (
    key: ProviderKey,
    field: 'baseUrl' | 'apiKey' | 'model' | 'voice',
    value: string,
  ) => {
    updateSetting({
      ...settings,
      multimodalProviders: {
        ...multimodalProviders,
        [key]: {
          ...(multimodalProviders[key] || {}),
          [field]: value,
        },
      },
    });
  };

  return (
    <div className="space-y-4">
      {providers.map((provider) => {
        const Icon = provider.icon;
        const value = multimodalProviders[provider.key] || {};
        return (
          <section
            key={provider.key}
            className="rounded-lg border border-border bg-background p-4"
          >
            <div className="mb-4 flex items-center gap-2">
              <Icon className="h-4 w-4" />
              <h3 className="font-medium">{provider.title}</h3>
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              {provider.fields.map((field) => (
                <div key={field} className="space-y-2">
                  <Label htmlFor={`${provider.key}-${field}`}>
                    {labels[field]}
                  </Label>
                  <Input
                    id={`${provider.key}-${field}`}
                    type={field === 'apiKey' ? 'password' : 'text'}
                    value={value[field] || ''}
                    placeholder={
                      field === 'baseUrl' ? 'https://api.example.com/v1' : field
                    }
                    onChange={(event) =>
                      updateProvider(provider.key, field, event.target.value)
                    }
                  />
                </div>
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}
