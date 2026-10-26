const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('lyricSettings',{read:()=>ipcRenderer.invoke('mineradio-settings-read'),fonts:()=>ipcRenderer.invoke('mineradio-settings-fonts'),preview:value=>ipcRenderer.invoke('mineradio-settings-preview',value),save:value=>ipcRenderer.invoke('mineradio-settings-save',value)});
