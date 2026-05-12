/**
 * Copyright (c) 2025 Neura.
 * SPDX-License-Identifier: Apache-2.0
 */
import { memo, useState } from 'react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@renderer/components/ui/alert-dialog';
import { Checkbox } from '@renderer/components/ui/checkbox';
import { Label } from '@renderer/components/ui/label';

interface FreeTrialDialog {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
}

export const FreeTrialDialog = memo(
  ({ open, onOpenChange, onConfirm }: FreeTrialDialog) => {
    const [dontShowAgain, setDontShowAgain] = useState(false);

    const onCheck = (status: boolean) => {
      setDontShowAgain(status);
    };

    const onClick = () => {
      if (dontShowAgain) {
        localStorage.setItem('isAgreeFreeTrialAgreement', 'true');
      }
      onConfirm();
    };

    return (
      <AlertDialog open={open} onOpenChange={onOpenChange}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Free Trial Service Agreement</AlertDialogTitle>
            <AlertDialogDescription className="hidden" />
            <div className="text-muted-foreground text-sm">
              <p>
                Neura is designed to work local-first. This optional remote
                trial is a legacy research service for users who explicitly want
                remote computer or browser operations; it is not required for
                normal Neura tasks.
              </p>
              <p className="my-4">
                <b>
                  By agreeing to use the optional remote service, your data will
                  be transmitted to servers. Please note that.
                </b>{' '}
                In compliance with relevant regulations, you should avoid
                entering any sensitive personal information. All records on the
                servers will be exclusively used for academic research purposes
                and will not be utilized for any other activities.
              </p>
              <p className="my-4">
                Thank you for your support of Neura Agent Operations!
              </p>
              <div className="flex items-center gap-2 mb-4 text-foreground">
                <Checkbox
                  id="free"
                  checked={dontShowAgain}
                  onCheckedChange={onCheck}
                />
                <Label htmlFor="free">I agree. Don't show this again</Label>
              </div>
            </div>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={onClick}>Agree</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    );
  },
);
