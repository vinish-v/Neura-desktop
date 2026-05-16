const vscode = require('vscode');

class NeuraCodeLensProvider {
  constructor(hasPendingProposalForDocument = () => false) {
    this.hasPendingProposalForDocument = hasPendingProposalForDocument;
  }

  provideCodeLenses(document) {
    if (document.uri.scheme !== 'file') return [];
    const top = new vscode.Range(0, 0, 0, 0);
    const lenses = [
      new vscode.CodeLens(top, {
        title: 'Neura: Edit Selection',
        command: 'neura.editSelection',
      }),
      new vscode.CodeLens(top, {
        title: 'Neura: Explain File',
        command: 'neura.explainCurrentFile',
      }),
    ];
    if (this.hasPendingProposalForDocument(document)) {
      lenses.unshift(
        new vscode.CodeLens(top, {
          title: 'Neura: Accept Hunk',
          command: 'neura.acceptCurrentFileHunk',
        }),
        new vscode.CodeLens(top, {
          title: 'Neura: Reject Hunk',
          command: 'neura.rejectCurrentFileHunk',
        }),
        new vscode.CodeLens(top, {
          title: 'Neura: Review Pending Edit',
          command: 'neura.reviewCurrentFileProposal',
        }),
        new vscode.CodeLens(top, {
          title: 'Neura: Accept File',
          command: 'neura.acceptCurrentFileProposal',
        }),
        new vscode.CodeLens(top, {
          title: 'Neura: Reject File',
          command: 'neura.rejectCurrentFileProposal',
        }),
        new vscode.CodeLens(top, {
          title: 'Neura: Reapply File',
          command: 'neura.reapplyCurrentFileProposal',
        }),
      );
    }
    return lenses;
  }
}

module.exports = { NeuraCodeLensProvider };
