interface WorkspaceFolder {
  name: string
  path: string
}

export interface Workspace {
  folders: WorkspaceFolder[]
  settings: {
    'terminal.integrated.cwd': string
  }
}

export const codeWorkspace: Workspace = {
  folders: [
    {
      name: 'root',
      path: '.',
    },
    {
      name: 'template',
      path: 'template',
    },
    {
      name: 'slot',
      path: 'slot',
    },
  ],
  settings: {
    'terminal.integrated.cwd': '${workspaceFolder:root}',
  },
}
