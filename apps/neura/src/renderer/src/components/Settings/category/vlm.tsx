/**
 * Copyright (c) 2025 Neura.
 * SPDX-License-Identifier: Apache-2.0
 */
import { useEffect, useState, useImperativeHandle } from 'react';
import { CheckCircle, XCircle, Loader2, EyeOff, Eye } from 'lucide-react';
import * as z from 'zod';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';

import { VLMProviderV2 } from '@main/store/types';
import { useSetting } from '@renderer/hooks/useSetting';
import { Button } from '@renderer/components/ui/button';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@renderer/components/ui/form';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@renderer/components/ui/select';
import { Input } from '@renderer/components/ui/input';
import { Switch } from '@renderer/components/ui/switch';
import { Alert, AlertDescription } from '@renderer/components/ui/alert';
import { cn } from '@renderer/utils';

import { PresetImport, PresetBanner } from './preset';
import { api } from '@/renderer/src/api';
import { relaxedZodResolver } from '@renderer/utils/relaxedZodResolver';

const formSchema = z.object({
  vlmProvider: z.nativeEnum(VLMProviderV2, {
    message: 'Please select a VLM Provider to enhance resolution',
  }),
  vlmBaseUrl: z.string().url(),
  vlmApiKey: z.string().min(1),
  vlmModelName: z.string().min(1),
  useResponsesApi: z.boolean().default(false),
  usePlannerModel: z.boolean().default(true),
  plannerBaseUrl: z.string().url(),
  plannerApiKey: z.string().optional(),
  plannerModelName: z.string().min(1),
  modelTimeoutInMs: z.coerce.number().min(30_000).max(600_000),
  plannerTimeoutInMs: z.coerce.number().min(15_000).max(300_000),
});

export interface VLMSettingsRef {
  submit: () => Promise<z.infer<typeof formSchema>>;
}

interface VLMSettingsProps {
  ref?: React.RefObject<VLMSettingsRef | null>;
  autoSave?: boolean;
  className?: string;
}

export function VLMSettings({
  ref,
  autoSave = false,
  className,
}: VLMSettingsProps) {
  const { settings, updateSetting, updatePresetFromRemote } = useSetting();
  const [isPresetModalOpen, setPresetModalOpen] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showPlannerPassword, setShowPlannerPassword] = useState(false);
  const [responseApiSupported, setResponseApiSupported] = useState<
    boolean | null
  >(null);
  const [isCheckingResponseApi, setIsCheckingResponseApi] = useState(false);

  const isRemoteAutoUpdatedPreset =
    settings?.presetSource?.type === 'remote' &&
    settings.presetSource.autoUpdate;

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: relaxedZodResolver(formSchema),
    defaultValues: {
      vlmProvider: VLMProviderV2.nvidia_nim,
      vlmBaseUrl: 'https://integrate.api.nvidia.com/v1',
      vlmApiKey: '',
      vlmModelName: 'meta/llama-3.2-11b-vision-instruct',
      useResponsesApi: false,
      usePlannerModel: true,
      plannerBaseUrl: 'https://integrate.api.nvidia.com/v1',
      plannerApiKey: '',
      plannerModelName: 'nvidia/nemotron-3-nano-30b-a3b',
      modelTimeoutInMs: 240_000,
      plannerTimeoutInMs: 90_000,
    },
  });
  useEffect(() => {
    if (Object.keys(settings).length) {
      form.reset({
        vlmProvider: settings.vlmProvider,
        vlmBaseUrl: settings.vlmBaseUrl,
        vlmApiKey: settings.vlmApiKey,
        vlmModelName: settings.vlmModelName,
        useResponsesApi: settings.useResponsesApi,
        usePlannerModel: settings.usePlannerModel ?? true,
        plannerBaseUrl:
          settings.plannerBaseUrl || 'https://integrate.api.nvidia.com/v1',
        plannerApiKey: settings.plannerApiKey || '',
        plannerModelName:
          settings.plannerModelName || 'nvidia/nemotron-3-nano-30b-a3b',
        modelTimeoutInMs: settings.modelTimeoutInMs || 240_000,
        plannerTimeoutInMs: settings.plannerTimeoutInMs || 90_000,
      });
    }
  }, [settings, form]);

  const [
    newProvider,
    newBaseUrl,
    newApiKey,
    newModelName,
    newUseResponsesApi,
    newUsePlannerModel,
    newPlannerBaseUrl,
    newPlannerApiKey,
    newPlannerModelName,
    newModelTimeoutInMs,
    newPlannerTimeoutInMs,
  ] = form.watch([
    'vlmProvider',
    'vlmBaseUrl',
    'vlmApiKey',
    'vlmModelName',
    'useResponsesApi',
    'usePlannerModel',
    'plannerBaseUrl',
    'plannerApiKey',
    'plannerModelName',
    'modelTimeoutInMs',
    'plannerTimeoutInMs',
  ]);

  useEffect(() => {
    if (!autoSave) {
      return;
    }
    if (isRemoteAutoUpdatedPreset) {
      return;
    }

    if (!Object.keys(settings).length) {
      return;
    }
    if (
      newProvider === undefined &&
      newBaseUrl === '' &&
      newApiKey === '' &&
      newModelName === ''
    ) {
      return;
    }

    const validAndSave = async () => {
      if (newProvider !== settings.vlmProvider) {
        updateSetting({ ...settings, vlmProvider: newProvider });
      }

      const isUrlValid = await form.trigger('vlmBaseUrl');
      if (isUrlValid && newBaseUrl !== settings.vlmBaseUrl) {
        updateSetting({ ...settings, vlmBaseUrl: newBaseUrl });
      }

      const isKeyValid = await form.trigger('vlmApiKey');
      if (isKeyValid && newApiKey !== settings.vlmApiKey) {
        updateSetting({ ...settings, vlmApiKey: newApiKey });
      }

      const isNameValid = await form.trigger('vlmModelName');
      if (isNameValid && newModelName !== settings.vlmModelName) {
        updateSetting({ ...settings, vlmModelName: newModelName });
      }

      const isResponsesApiValid = await form.trigger('useResponsesApi');
      if (
        isResponsesApiValid &&
        newUseResponsesApi !== settings.useResponsesApi
      ) {
        updateSetting({
          ...settings,
          useResponsesApi: newUseResponsesApi,
        });
      }

      const isPlannerEnabledValid = await form.trigger('usePlannerModel');
      if (
        isPlannerEnabledValid &&
        newUsePlannerModel !== settings.usePlannerModel
      ) {
        updateSetting({
          ...settings,
          usePlannerModel: newUsePlannerModel,
        });
      }

      const isPlannerBaseUrlValid = await form.trigger('plannerBaseUrl');
      if (
        isPlannerBaseUrlValid &&
        newPlannerBaseUrl !== settings.plannerBaseUrl
      ) {
        updateSetting({
          ...settings,
          plannerBaseUrl: newPlannerBaseUrl,
        });
      }

      const isPlannerApiKeyValid = await form.trigger('plannerApiKey');
      if (isPlannerApiKeyValid && newPlannerApiKey !== settings.plannerApiKey) {
        updateSetting({
          ...settings,
          plannerApiKey: newPlannerApiKey,
        });
      }

      const isPlannerModelNameValid = await form.trigger('plannerModelName');
      if (
        isPlannerModelNameValid &&
        newPlannerModelName !== settings.plannerModelName
      ) {
        updateSetting({
          ...settings,
          plannerModelName: newPlannerModelName,
        });
      }

      const isModelTimeoutValid = await form.trigger('modelTimeoutInMs');
      if (
        isModelTimeoutValid &&
        newModelTimeoutInMs !== settings.modelTimeoutInMs
      ) {
        updateSetting({
          ...settings,
          modelTimeoutInMs: newModelTimeoutInMs,
        });
      }

      const isPlannerTimeoutValid = await form.trigger('plannerTimeoutInMs');
      if (
        isPlannerTimeoutValid &&
        newPlannerTimeoutInMs !== settings.plannerTimeoutInMs
      ) {
        updateSetting({
          ...settings,
          plannerTimeoutInMs: newPlannerTimeoutInMs,
        });
      }
    };

    validAndSave();
  }, [
    autoSave,
    newProvider,
    newBaseUrl,
    newApiKey,
    newModelName,
    newUseResponsesApi,
    newUsePlannerModel,
    newPlannerBaseUrl,
    newPlannerApiKey,
    newPlannerModelName,
    newModelTimeoutInMs,
    newPlannerTimeoutInMs,
    settings,
    updateSetting,
    form,
    isRemoteAutoUpdatedPreset,
  ]);

  const handlePresetModal = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    setPresetModalOpen(true);
  };

  const handleUpdatePreset = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    try {
      await updatePresetFromRemote();
      // toast.success('Preset updated successfully');
    } catch (error) {
      toast.error('Failed to update preset', {
        description:
          error instanceof Error ? error.message : 'Unknown error occurred',
      });
    }
  };

  const handleResetPreset = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    await window.electron.setting.resetPreset();
    toast.success('Reset to manual mode successfully', {
      duration: 1500,
    });
  };

  const handleResponseApiChange = async (checked: boolean) => {
    if (checked) {
      if (responseApiSupported === null) {
        setIsCheckingResponseApi(true);
        const modelConfig = {
          baseUrl: newBaseUrl,
          apiKey: newApiKey,
          modelName: newModelName,
        };

        if (
          !modelConfig.baseUrl ||
          !modelConfig.apiKey ||
          !modelConfig.modelName
        ) {
          toast.error(
            'Please fill in all required fields before enabling Response API',
          );
          setIsCheckingResponseApi(false);
          return;
        }

        const isSupported = await api.checkVLMResponseApiSupport(modelConfig);
        setResponseApiSupported(isSupported);
        setIsCheckingResponseApi(false);

        if (!isSupported) {
          return;
        }
      }

      if (responseApiSupported) {
        form.setValue('useResponsesApi', true);
      }
    } else {
      form.setValue('useResponsesApi', false);
    }
  };

  const onSubmit = async (values: z.infer<typeof formSchema>) => {
    updateSetting({ ...settings, ...values });
    toast.success('Settings saved successfully');
  };

  useImperativeHandle(ref, () => ({
    submit: async () => {
      return new Promise<z.infer<typeof formSchema>>((resolve, reject) => {
        form.handleSubmit(
          (values) => {
            onSubmit(values);
            resolve(values);
          },
          (errors) => {
            reject(errors);
          },
        )();
      });
    },
  }));

  const switchDisabled =
    isRemoteAutoUpdatedPreset ||
    responseApiSupported === false ||
    isCheckingResponseApi;

  return (
    <>
      <Form {...form}>
        <form className={cn('space-y-8 px-[1px]', className)}>
          {!isRemoteAutoUpdatedPreset && (
            <Button type="button" variant="outline" onClick={handlePresetModal}>
              Import Preset Config
            </Button>
          )}
          {isRemoteAutoUpdatedPreset && (
            <PresetBanner
              url={settings.presetSource?.url}
              date={settings.presetSource?.lastUpdated}
              handleUpdatePreset={handleUpdatePreset}
              handleResetPreset={handleResetPreset}
            />
          )}

          {/* VLM Provider */}
          <FormField
            control={form.control}
            name="vlmProvider"
            render={({ field }) => {
              return (
                <FormItem>
                  <FormLabel>VLM Provider</FormLabel>
                  <Select
                    disabled={isRemoteAutoUpdatedPreset}
                    onValueChange={field.onChange}
                    value={field.value}
                  >
                    <SelectTrigger className="w-full bg-white">
                      <SelectValue placeholder="Select VLM provider" />
                    </SelectTrigger>
                    <SelectContent>
                      {Object.values(VLMProviderV2).map((provider) => (
                        <SelectItem key={provider} value={provider}>
                          {provider}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              );
            }}
          />
          {/* VLM Base URL */}
          <FormField
            control={form.control}
            name="vlmBaseUrl"
            render={({ field }) => (
              <FormItem>
                <FormLabel>VLM Base URL</FormLabel>
                <FormControl>
                  <Input
                    className="bg-white"
                    placeholder="https://integrate.api.nvidia.com/v1"
                    {...field}
                    disabled={isRemoteAutoUpdatedPreset}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          {/* VLM API Key */}
          <FormField
            control={form.control}
            name="vlmApiKey"
            render={({ field }) => (
              <FormItem>
                <FormLabel>VLM API Key</FormLabel>
                <FormControl>
                  <div className="relative">
                    <Input
                      type={showPassword ? 'text' : 'password'}
                      className="bg-white"
                      placeholder="Enter NVIDIA NIM API key"
                      {...field}
                      disabled={isRemoteAutoUpdatedPreset}
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="absolute right-0 top-0 h-full px-3 py-2 hover:bg-transparent"
                      onClick={() => setShowPassword(!showPassword)}
                      disabled={isRemoteAutoUpdatedPreset}
                    >
                      {showPassword ? (
                        <Eye className="h-4 w-4 text-gray-500" />
                      ) : (
                        <EyeOff className="h-4 w-4 text-gray-500" />
                      )}
                    </Button>
                  </div>
                </FormControl>
              </FormItem>
            )}
          />
          {/* VLM Model Name */}
          <FormField
            control={form.control}
            name="vlmModelName"
            render={({ field }) => (
              <FormItem>
                <FormLabel>VLM Model Name</FormLabel>
                <FormControl>
                  <Input
                    className="bg-white"
                    placeholder="meta/llama-3.2-11b-vision-instruct"
                    {...field}
                    disabled={isRemoteAutoUpdatedPreset}
                  />
                </FormControl>
              </FormItem>
            )}
          />

          {/* Model Availability Check */}
          <ModelAvailabilityCheck
            modelConfig={{
              baseUrl: newBaseUrl,
              apiKey: newApiKey,
              modelName: newModelName,
            }}
            onResponseApiSupportChange={setResponseApiSupported}
          />

          <FormField
            control={form.control}
            name="modelTimeoutInMs"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Vision Timeout (ms)</FormLabel>
                <FormControl>
                  <Input
                    type="number"
                    min={30_000}
                    max={600_000}
                    step={15_000}
                    className="bg-white"
                    {...field}
                    onChange={(event) =>
                      field.onChange(event.target.valueAsNumber)
                    }
                    disabled={isRemoteAutoUpdatedPreset}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          {/* Planner Model */}
          <FormField
            control={form.control}
            name="usePlannerModel"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Use Planner Model</FormLabel>
                <FormControl>
                  <div className="flex items-center gap-3">
                    <Switch
                      checked={field.value}
                      disabled={isRemoteAutoUpdatedPreset}
                      onCheckedChange={field.onChange}
                    />
                    <p className="text-sm text-muted-foreground">
                      Text-only planning before each vision action
                    </p>
                  </div>
                </FormControl>
              </FormItem>
            )}
          />

          {newUsePlannerModel && (
            <>
              <FormField
                control={form.control}
                name="plannerBaseUrl"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Planner Base URL</FormLabel>
                    <FormControl>
                      <Input
                        className="bg-white"
                        placeholder="https://integrate.api.nvidia.com/v1"
                        {...field}
                        disabled={isRemoteAutoUpdatedPreset}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="plannerApiKey"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Planner API Key</FormLabel>
                    <FormControl>
                      <div className="relative">
                        <Input
                          type={showPlannerPassword ? 'text' : 'password'}
                          className="bg-white"
                          placeholder="Leave empty to reuse VLM API key"
                          {...field}
                          disabled={isRemoteAutoUpdatedPreset}
                        />
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="absolute right-0 top-0 h-full px-3 py-2 hover:bg-transparent"
                          onClick={() =>
                            setShowPlannerPassword(!showPlannerPassword)
                          }
                          disabled={isRemoteAutoUpdatedPreset}
                        >
                          {showPlannerPassword ? (
                            <Eye className="h-4 w-4 text-gray-500" />
                          ) : (
                            <EyeOff className="h-4 w-4 text-gray-500" />
                          )}
                        </Button>
                      </div>
                    </FormControl>
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="plannerModelName"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Planner Model Name</FormLabel>
                    <FormControl>
                      <Input
                        className="bg-white"
                        placeholder="nvidia/nemotron-3-nano-30b-a3b"
                        {...field}
                        disabled={isRemoteAutoUpdatedPreset}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <ModelAvailabilityCheck
                modelConfig={{
                  baseUrl: newPlannerBaseUrl,
                  apiKey: newPlannerApiKey || newApiKey,
                  modelName: newPlannerModelName,
                }}
                disabled={
                  !newPlannerModelName || !(newPlannerApiKey || newApiKey)
                }
              />

              <FormField
                control={form.control}
                name="plannerTimeoutInMs"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Planner Timeout (ms)</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        min={15_000}
                        max={300_000}
                        step={15_000}
                        className="bg-white"
                        {...field}
                        onChange={(event) =>
                          field.onChange(event.target.valueAsNumber)
                        }
                        disabled={isRemoteAutoUpdatedPreset}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </>
          )}

          {/* VLM Model Responses API */}
          <FormField
            control={form.control}
            name="useResponsesApi"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Use Responses API</FormLabel>
                <FormControl>
                  <div className="flex items-center gap-3">
                    <Switch
                      checked={field.value}
                      disabled={switchDisabled}
                      onCheckedChange={handleResponseApiChange}
                      className={cn(switchDisabled && '!cursor-not-allowed')}
                    />
                    {responseApiSupported === false && (
                      <p className="text-sm text-red-500">
                        Response API is not supported by this model
                      </p>
                    )}
                    {isCheckingResponseApi && (
                      <p className="text-sm text-muted-foreground flex items-center">
                        <Loader2 className="mr-2 h-3 w-3 animate-spin" />
                        Checking Response API support...
                      </p>
                    )}
                  </div>
                </FormControl>
              </FormItem>
            )}
          />
        </form>
      </Form>

      <PresetImport
        isOpen={isPresetModalOpen}
        onClose={() => setPresetModalOpen(false)}
      />
    </>
  );
}

interface ModelAvailabilityCheckProps {
  modelConfig: {
    baseUrl: string;
    apiKey: string;
    modelName: string;
  };
  disabled?: boolean;
  className?: string;
  onResponseApiSupportChange?: (supported: boolean) => void;
}

type CheckStatus = 'idle' | 'checking' | 'success' | 'error';

interface CheckState {
  status: CheckStatus;
  message?: string;
  responseApiSupported?: boolean;
}

export function ModelAvailabilityCheck({
  modelConfig,
  disabled = false,
  className,
  onResponseApiSupportChange,
}: ModelAvailabilityCheckProps) {
  const [checkState, setCheckState] = useState<CheckState>({ status: 'idle' });

  const { baseUrl, apiKey, modelName } = modelConfig;
  const isConfigValid = baseUrl && apiKey && modelName;

  useEffect(() => {
    if (checkState.status === 'success' || checkState.status === 'error') {
      setTimeout(() => {
        // Find the nearest scrollable container
        const scrollContainer = document.querySelector(
          '[data-radix-scroll-area-viewport]',
        );
        if (scrollContainer) {
          scrollContainer.scrollTo({
            top: scrollContainer.scrollHeight,
            behavior: 'smooth',
          });
        }
      }, 200);
    }
  }, [checkState.status]);

  const handleCheckModel = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    if (!isConfigValid) {
      toast.error(
        'Please fill in all required fields before checking model availability',
      );
      return;
    }

    setCheckState({ status: 'checking' });

    try {
      const [isAvailable, responseApiSupported] = await Promise.all([
        api.checkModelAvailability(modelConfig),
        api.checkVLMResponseApiSupport(modelConfig),
      ]);

      onResponseApiSupportChange?.(responseApiSupported);

      if (isAvailable) {
        const successMessage = `Model "${modelName}" is available and working correctly${
          responseApiSupported
            ? '. Response API is supported.'
            : '. But Response API is not supported.'
        }`;
        setCheckState({
          status: 'success',
          message: successMessage,
          responseApiSupported,
        });
      } else {
        const errorMessage = `Model "${modelName}" is not responding correctly`;
        setCheckState({
          status: 'error',
          message: errorMessage,
          responseApiSupported,
        });
        console.error('[VLM Model Check] Model not responding');
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error occurred';
      const fullErrorMessage = `Failed to connect to model: ${errorMessage}`;

      setCheckState({
        status: 'error',
        message: fullErrorMessage,
      });

      onResponseApiSupportChange?.(false);

      console.error('[VLM Model Check] Error:', error, {
        baseUrl,
        modelName,
      });
    }
  };

  return (
    <div className={`space-y-4 ${className || ''}`}>
      <Button
        type="button"
        variant="outline"
        onClick={handleCheckModel}
        disabled={
          disabled || checkState.status === 'checking' || !isConfigValid
        }
        className="w-50"
      >
        {checkState.status === 'checking' ? (
          <>
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            Checking Model...
          </>
        ) : (
          'Check Model Availability'
        )}
      </Button>

      {checkState.status === 'success' && (
        <Alert className="border-green-200 bg-green-50">
          <CheckCircle className="h-4 w-4 !text-green-600" />
          <AlertDescription className="text-green-800">
            {checkState.message}
          </AlertDescription>
        </Alert>
      )}

      {checkState.status === 'error' && (
        <Alert className="border-red-200 bg-red-50">
          <XCircle className="h-4 w-4 !text-red-600" />
          <AlertDescription className="text-red-800">
            {checkState.message}
          </AlertDescription>
        </Alert>
      )}
    </div>
  );
}
