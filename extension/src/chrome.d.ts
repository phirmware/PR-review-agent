declare namespace chrome {
  namespace runtime {
    interface InstalledDetails {
      reason: string;
    }

    const onInstalled: {
      addListener(callback: (details: InstalledDetails) => void): void;
    };

    const onMessage: {
      addListener(
        callback: (
          message: unknown,
          sender: unknown,
          sendResponse: (response?: unknown) => void
        ) => void | boolean
      ): void;
    };
  }

  namespace contextMenus {
    interface CreateProperties {
      id: string;
      title: string;
      contexts: string[];
      documentUrlPatterns?: string[];
    }

    interface OnClickData {
      menuItemId: string | number;
      selectionText?: string;
    }

    const create: (properties: CreateProperties) => void;
    const removeAll: (callback?: () => void) => void;
    const onClicked: {
      addListener(callback: (info: OnClickData, tab?: tabs.Tab) => void): void;
    };
  }

  namespace tabs {
    interface Tab {
      id?: number;
    }

    const sendMessage: (tabId: number, message: unknown) => void;
  }

  namespace storage {
    interface StorageArea {
      get(keys: string): Promise<Record<string, unknown>>;
      set(items: Record<string, unknown>): Promise<void>;
    }

    const local: StorageArea;
  }
}

interface Window {
  chrome?: typeof chrome;
}
