import { useMemo, useState, type ReactNode } from 'react';
import { create } from 'zustand';
import {
  BrainCircuit,
  Check,
  Cloud,
  Gauge,
  Image,
  KeyRound,
  Mic,
  RotateCw,
  Settings2,
  Video,
} from 'lucide-react';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@renderer/components/ui/dialog';
import { Button } from '@renderer/components/ui/button';
import { Input } from '@renderer/components/ui/input';
import { Label } from '@renderer/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@renderer/components/ui/select';
import { Switch } from '@renderer/components/ui/switch';
import { ScrollArea } from '@renderer/components/ui/scroll-area';
import { VLMProviderV2 } from '@main/store/types';
import { useSetting } from '@renderer/hooks/useSetting';
import { cn } from '@renderer/utils';
import {
  getMultimodalProviderReadiness,
  MULTIMODAL_PROVIDER_DEFINITIONS,
  type MultimodalProviderKey,
  type MultimodalProviderConfig,
} from '@shared/multimodalReadiness';

interface GlobalSettingsStore {
  isOpen: boolean;
  openSettings: () => void;
  closeSettings: () => void;
  toggleSettings: () => void;
}

export const useGlobalSettings = create<GlobalSettingsStore>((set) => ({
  isOpen: false,
  openSettings: () => set({ isOpen: true }),
  closeSettings: () => set({ isOpen: false }),
  toggleSettings: () => set((state) => ({ isOpen: !state.isOpen })),
}));

const sections = [
  { id: 'model', title: 'Model', icon: BrainCircuit },
  { id: 'planner', title: 'Planner', icon: Gauge },
  { id: 'runtime', title: 'Runtime', icon: Cloud },
  { id: 'multimodal', title: 'Multimodal', icon: Image },
  { id: 'behavior', title: 'Behavior', icon: Settings2 },
] as const;

type SectionId = (typeof sections)[number]['id'];

const Field = ({
  label,
  children,
  detail,
}: {
  label: string;
  children: ReactNode;
  detail?: string;
}) => (
  <div className="rounded-[22px] border border-[#f6f1e8]/[0.09] bg-[#f6f1e8]/[0.035] p-4">
    <Label className="text-[12px] font-semibold uppercase tracking-[0.14em] text-[#f6f1e8]/48">
      {label}
    </Label>
    <div className="mt-3">{children}</div>
    {detail ? (
      <p className="mt-2 text-xs leading-5 text-[#f6f1e8]/42">{detail}</p>
    ) : null}
  </div>
);

const multimodalIcons: Record<MultimodalProviderKey, typeof Image> = {
  image: Image,
  speechToText: Mic,
  textToSpeech: Mic,
  video: Video,
};

const multimodalFieldLabels: Record<keyof MultimodalProviderConfig, string> = {
  baseUrl: 'Base URL',
  apiKey: 'API key',
  model: 'Model',
  voice: 'Voice',
};

export const GlobalSettings = () => {
  const { isOpen, toggleSettings } = useGlobalSettings();
  const { settings, updateSetting, clearSetting } = useSetting();
  const [active, setActive] = useState<SectionId>('model');
  const [showKeys, setShowKeys] = useState(false);

  const modelReady = useMemo(
    () =>
      Boolean(
        settings.vlmBaseUrl?.trim() &&
          settings.vlmApiKey?.trim() &&
          settings.vlmModelName?.trim(),
      ),
    [settings.vlmApiKey, settings.vlmBaseUrl, settings.vlmModelName],
  );

  const multimodalReadiness = useMemo(
    () => getMultimodalProviderReadiness(settings.multimodalProviders),
    [settings.multimodalProviders],
  );

  const multimodalReadyCount = multimodalReadiness.filter(
    (item) => item.configured,
  ).length;

  const save = (patch: Partial<typeof settings>) => {
    updateSetting({ ...settings, ...patch });
  };

  const saveMultimodalProvider = (
    key: MultimodalProviderKey,
    field: keyof MultimodalProviderConfig,
    value: string,
  ) => {
    const providers = settings.multimodalProviders || {};
    save({
      multimodalProviders: {
        ...providers,
        [key]: {
          ...(providers[key] || {}),
          [field]: value,
        },
      },
    });
  };

  return (
    <Dialog open={isOpen} onOpenChange={toggleSettings}>
      <DialogContent className="h-[82vh] min-w-[min(1040px,92vw)] overflow-hidden rounded-[34px] border border-[#f6f1e8]/[0.12] bg-[#080807] p-0 text-[#f6f1e8] shadow-[0_40px_140px_rgba(0,0,0,0.55)] [&>button:last-child]:hidden">
        <DialogHeader className="sr-only">
          <DialogTitle>Settings</DialogTitle>
          <DialogDescription>Configure Neura runtime settings.</DialogDescription>
        </DialogHeader>

        <div className="grid h-full grid-cols-[260px_minmax(0,1fr)]">
          <aside className="border-r border-[#f6f1e8]/[0.08] bg-[#f6f1e8]/[0.035] p-5">
            <div className="mb-8">
              <div className="text-[12px] font-semibold uppercase tracking-[0.18em] text-[#f6f1e8]/42">
                Settings
              </div>
              <div className="mt-3 text-[30px] font-semibold leading-none tracking-normal">
                Keep only what runs Neura.
              </div>
            </div>

            <div className="grid gap-2">
              {sections.map((section) => {
                const Icon = section.icon;
                return (
                  <button
                    key={section.id}
                    type="button"
                    onClick={() => setActive(section.id)}
                    className={cn(
                      'flex items-center gap-3 rounded-full border px-4 py-3 text-left text-sm font-semibold transition',
                      active === section.id
                        ? 'border-[#f6f1e8]/20 bg-[#f6f1e8] text-black'
                        : 'border-[#f6f1e8]/[0.08] bg-transparent text-[#f6f1e8]/62 hover:bg-[#f6f1e8]/[0.06] hover:text-[#f6f1e8]',
                    )}
                  >
                    <Icon className="h-4 w-4" />
                    {section.title}
                  </button>
                );
              })}
            </div>

            <div className="mt-8">
              <div className="rounded-[22px] border border-[#f6f1e8]/[0.09] bg-black/20 p-4">
                <div className="flex items-center gap-2 text-sm font-semibold">
                  <span
                    className={cn(
                      'h-2 w-2 rounded-full',
                      modelReady ? 'bg-emerald-300' : 'bg-amber-300',
                    )}
                  />
                  {modelReady ? 'Ready' : 'Needs model'}
                </div>
                <p className="mt-2 text-xs leading-5 text-[#f6f1e8]/42">
                  Credentials stay in the local app settings and are never shown
                  unless you choose to reveal them.
                </p>
              </div>
            </div>
          </aside>

          <ScrollArea className="h-full">
            <main className="p-7">
              {active === 'model' && (
                <section className="grid gap-4">
                  <div className="mb-2 flex items-start justify-between gap-4">
                    <div>
                      <h2 className="text-[34px] font-semibold leading-none">
                        Runtime model
                      </h2>
                      <p className="mt-3 max-w-xl text-sm leading-6 text-[#f6f1e8]/46">
                        The model used for normal reasoning, visual inspection,
                        browser work, and local computer control.
                      </p>
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      className="rounded-full border-[#f6f1e8]/[0.12] bg-transparent text-[#f6f1e8] hover:bg-[#f6f1e8]/[0.08]"
                      onClick={() => setShowKeys((value) => !value)}
                    >
                      <KeyRound className="h-4 w-4" />
                      {showKeys ? 'Hide keys' : 'Reveal keys'}
                    </Button>
                  </div>

                  <Field label="Provider">
                    <Select
                      value={settings.vlmProvider || VLMProviderV2.nvidia_nim}
                      onValueChange={(vlmProvider) =>
                        save({ vlmProvider: vlmProvider as VLMProviderV2 })
                      }
                    >
                      <SelectTrigger className="h-11 rounded-full border-[#f6f1e8]/[0.12] bg-black/30 text-[#f6f1e8]">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {Object.values(VLMProviderV2).map((provider) => (
                          <SelectItem key={provider} value={provider}>
                            {provider}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </Field>

                  <Field label="Base URL">
                    <Input
                      value={settings.vlmBaseUrl || ''}
                      onChange={(event) =>
                        save({ vlmBaseUrl: event.target.value })
                      }
                      placeholder="https://api.example.com/v1"
                      className="h-11 rounded-full border-[#f6f1e8]/[0.12] bg-black/30 px-4 text-[#f6f1e8]"
                    />
                  </Field>

                  <Field label="API key">
                    <Input
                      type={showKeys ? 'text' : 'password'}
                      value={settings.vlmApiKey || ''}
                      onChange={(event) =>
                        save({ vlmApiKey: event.target.value })
                      }
                      placeholder="Paste model API key"
                      className="h-11 rounded-full border-[#f6f1e8]/[0.12] bg-black/30 px-4 text-[#f6f1e8]"
                    />
                  </Field>

                  <Field label="Model name">
                    <Input
                      value={settings.vlmModelName || ''}
                      onChange={(event) =>
                        save({ vlmModelName: event.target.value })
                      }
                      placeholder="provider/model-name"
                      className="h-11 rounded-full border-[#f6f1e8]/[0.12] bg-black/30 px-4 text-[#f6f1e8]"
                    />
                  </Field>
                </section>
              )}

              {active === 'planner' && (
                <section className="grid gap-4">
                  <div className="mb-2">
                    <h2 className="text-[34px] font-semibold leading-none">
                      Planner model
                    </h2>
                    <p className="mt-3 max-w-xl text-sm leading-6 text-[#f6f1e8]/46">
                      Optional text model used to plan steps before local and
                      browser actions. Leave the key empty to reuse the runtime
                      key.
                    </p>
                  </div>

                  <Field label="Use planner">
                    <div className="flex items-center gap-3">
                      <Switch
                        checked={settings.usePlannerModel !== false}
                        onCheckedChange={(usePlannerModel) =>
                          save({ usePlannerModel })
                        }
                      />
                      <span className="text-sm text-[#f6f1e8]/54">
                        Plan before executing complex actions
                      </span>
                    </div>
                  </Field>

                  <Field label="Planner base URL">
                    <Input
                      value={settings.plannerBaseUrl || ''}
                      onChange={(event) =>
                        save({ plannerBaseUrl: event.target.value })
                      }
                      placeholder={settings.vlmBaseUrl || 'https://api.example.com/v1'}
                      className="h-11 rounded-full border-[#f6f1e8]/[0.12] bg-black/30 px-4 text-[#f6f1e8]"
                    />
                  </Field>

                  <Field label="Planner API key">
                    <Input
                      type={showKeys ? 'text' : 'password'}
                      value={settings.plannerApiKey || ''}
                      onChange={(event) =>
                        save({ plannerApiKey: event.target.value })
                      }
                      placeholder="Leave empty to reuse runtime key"
                      className="h-11 rounded-full border-[#f6f1e8]/[0.12] bg-black/30 px-4 text-[#f6f1e8]"
                    />
                  </Field>

                  <Field label="Planner model">
                    <Input
                      value={settings.plannerModelName || ''}
                      onChange={(event) =>
                        save({ plannerModelName: event.target.value })
                      }
                      placeholder="provider/planner-model"
                      className="h-11 rounded-full border-[#f6f1e8]/[0.12] bg-black/30 px-4 text-[#f6f1e8]"
                    />
                  </Field>
                </section>
              )}

              {active === 'runtime' && (
                <section className="grid gap-4">
                  <div className="mb-2">
                    <h2 className="text-[34px] font-semibold leading-none">
                      Runtime
                    </h2>
                    <p className="mt-3 max-w-xl text-sm leading-6 text-[#f6f1e8]/46">
                      Choose how Neura opens browsers and resolves web data.
                      Local keeps the visible computer on this machine.
                    </p>
                  </div>

                  <Field
                    label="Browser backend"
                    detail="Use Local for visible takeover sessions. Cloud options are used only when their credentials or gateway are configured."
                  >
                    <Select
                      value={settings.hermesBrowserBackend || 'local'}
                      onValueChange={(hermesBrowserBackend) =>
                        save({
                          hermesBrowserBackend:
                            hermesBrowserBackend as typeof settings.hermesBrowserBackend,
                        })
                      }
                    >
                      <SelectTrigger className="h-11 rounded-full border-[#f6f1e8]/[0.12] bg-black/30 text-[#f6f1e8]">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="local">Local computer</SelectItem>
                        <SelectItem value="browser-use">Browser Use</SelectItem>
                        <SelectItem value="browserbase">Browserbase</SelectItem>
                        <SelectItem value="camofox">Camofox</SelectItem>
                        <SelectItem value="firecrawl">Firecrawl</SelectItem>
                      </SelectContent>
                    </Select>
                  </Field>

                  <Field
                    label="Web backend"
                    detail="Auto lets the runtime pick the best configured provider."
                  >
                    <Select
                      value={settings.hermesWebBackend || 'auto'}
                      onValueChange={(hermesWebBackend) =>
                        save({
                          hermesWebBackend:
                            hermesWebBackend as typeof settings.hermesWebBackend,
                        })
                      }
                    >
                      <SelectTrigger className="h-11 rounded-full border-[#f6f1e8]/[0.12] bg-black/30 text-[#f6f1e8]">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="auto">Auto</SelectItem>
                        <SelectItem value="firecrawl">Firecrawl</SelectItem>
                        <SelectItem value="tavily">Tavily</SelectItem>
                        <SelectItem value="parallel">Parallel</SelectItem>
                        <SelectItem value="exa">Exa</SelectItem>
                        <SelectItem value="searxng">SearXNG</SelectItem>
                      </SelectContent>
                    </Select>
                  </Field>

                  <Field label="Use managed gateway">
                    <div className="flex items-center gap-3">
                      <Switch
                        checked={settings.hermesUseGateway === true}
                        onCheckedChange={(hermesUseGateway) =>
                          save({ hermesUseGateway })
                        }
                      />
                      <span className="text-sm text-[#f6f1e8]/54">
                        Route configured cloud tools through the managed gateway
                      </span>
                    </div>
                  </Field>
                </section>
              )}

              {active === 'multimodal' && (
                <section className="grid gap-4">
                  <div className="mb-2">
                    <h2 className="text-[34px] font-semibold leading-none">
                      Multimodal providers
                    </h2>
                    <p className="mt-3 max-w-xl text-sm leading-6 text-[#f6f1e8]/46">
                      Optional local settings for real image, speech, audio,
                      and video tools. Missing setup is reported before tools
                      attempt generation.
                    </p>
                  </div>

                  <div className="rounded-[22px] border border-[#f6f1e8]/[0.09] bg-[#f6f1e8]/[0.035] p-4">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <div className="text-sm font-semibold">
                          Provider readiness
                        </div>
                        <p className="mt-1 text-xs leading-5 text-[#f6f1e8]/42">
                          {multimodalReadyCount} of{' '}
                          {multimodalReadiness.length} media providers ready.
                          Keys stay hidden and are not sent during readiness
                          checks.
                        </p>
                      </div>
                      <span
                        className={cn(
                          'rounded-full border px-3 py-1 text-xs font-semibold',
                          multimodalReadyCount === multimodalReadiness.length
                            ? 'border-emerald-300/30 bg-emerald-300/10 text-emerald-100'
                            : 'border-amber-300/30 bg-amber-300/10 text-amber-100',
                        )}
                      >
                        {multimodalReadyCount === multimodalReadiness.length
                          ? 'Ready'
                          : 'Needs setup'}
                      </span>
                    </div>
                  </div>

                  {MULTIMODAL_PROVIDER_DEFINITIONS.map((provider) => {
                    const readiness = multimodalReadiness.find(
                      (item) => item.key === provider.key,
                    );
                    const Icon = multimodalIcons[provider.key];
                    const value =
                      settings.multimodalProviders?.[provider.key] || {};
                    const fields = provider.key === 'textToSpeech'
                      ? [...provider.requiredFields, 'voice' as const]
                      : provider.requiredFields;

                    return (
                      <Field
                        key={provider.key}
                        label={provider.title}
                        detail={readiness?.setupMessage}
                      >
                        <div className="mb-3 flex items-center justify-between gap-3">
                          <div className="flex items-center gap-2 text-sm font-semibold">
                            <Icon className="h-4 w-4" />
                            {provider.toolName}
                          </div>
                          <span
                            className={cn(
                              'rounded-full border px-3 py-1 text-xs font-semibold',
                              readiness?.configured
                                ? 'border-emerald-300/30 bg-emerald-300/10 text-emerald-100'
                                : 'border-amber-300/30 bg-amber-300/10 text-amber-100',
                            )}
                          >
                            {readiness?.configured ? 'Ready' : 'Needs setup'}
                          </span>
                        </div>
                        <div className="grid gap-3 md:grid-cols-2">
                          {fields.map((field) => (
                            <div key={field} className="space-y-2">
                              <Label className="text-xs text-[#f6f1e8]/52">
                                {multimodalFieldLabels[field]}
                              </Label>
                              <Input
                                type={field === 'apiKey' && !showKeys ? 'password' : 'text'}
                                value={value[field] || ''}
                                onChange={(event) =>
                                  saveMultimodalProvider(
                                    provider.key,
                                    field,
                                    event.target.value,
                                  )
                                }
                                placeholder={
                                  field === 'baseUrl'
                                    ? 'https://api.example.com/v1'
                                    : multimodalFieldLabels[field]
                                }
                                className="h-11 rounded-full border-[#f6f1e8]/[0.12] bg-black/30 px-4 text-[#f6f1e8]"
                              />
                            </div>
                          ))}
                        </div>
                      </Field>
                    );
                  })}
                </section>
              )}

              {active === 'behavior' && (
                <section className="grid gap-4">
                  <div className="mb-2">
                    <h2 className="text-[34px] font-semibold leading-none">
                      Behavior
                    </h2>
                    <p className="mt-3 max-w-xl text-sm leading-6 text-[#f6f1e8]/46">
                      Basic runtime limits. Integrations live on the Connectors
                      page.
                    </p>
                  </div>

                  <Field label="Language">
                    <Select
                      value={settings.language || 'en'}
                      onValueChange={(language: 'en' | 'zh') =>
                        save({ language })
                      }
                    >
                      <SelectTrigger className="h-11 rounded-full border-[#f6f1e8]/[0.12] bg-black/30 px-4 text-[#f6f1e8]">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="en">English</SelectItem>
                        <SelectItem value="zh">Chinese</SelectItem>
                      </SelectContent>
                    </Select>
                  </Field>

                  <Field label="Max action loops">
                    <Input
                      type="number"
                      min={1}
                      value={settings.maxLoopCount || 15}
                      onChange={(event) =>
                        save({ maxLoopCount: event.target.valueAsNumber })
                      }
                      className="h-11 rounded-full border-[#f6f1e8]/[0.12] bg-black/30 px-4 text-[#f6f1e8]"
                    />
                  </Field>

                  <Field label="Loop interval in ms">
                    <Input
                      type="number"
                      min={250}
                      step={250}
                      value={settings.loopIntervalInMs || 1000}
                      onChange={(event) =>
                        save({ loopIntervalInMs: event.target.valueAsNumber })
                      }
                      className="h-11 rounded-full border-[#f6f1e8]/[0.12] bg-black/30 px-4 text-[#f6f1e8]"
                    />
                  </Field>

                  <div className="mt-3 flex justify-end gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      className="rounded-full border-red-300/20 bg-red-300/10 text-red-100 hover:bg-red-300/15"
                      onClick={clearSetting}
                    >
                      <RotateCw className="h-4 w-4" />
                      Reset settings
                    </Button>
                    <Button
                      type="button"
                      className="rounded-full bg-[#f6f1e8] text-black hover:bg-white"
                      onClick={toggleSettings}
                    >
                      <Check className="h-4 w-4" />
                      Done
                    </Button>
                  </div>
                </section>
              )}
            </main>
          </ScrollArea>
        </div>
      </DialogContent>
    </Dialog>
  );
};
