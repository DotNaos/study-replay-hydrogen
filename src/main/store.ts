import ElectronStore from "electron-store";
const Store = ElectronStore;

export type Credentials = {
  username?: string;
  password?: string;
};

export type Preferences = {
  autoLogin: boolean;
};

export type StoreSchema = {
  selectedSchool?: string;
  schools: Record<string, Credentials>;
  preferences: Preferences;
};

export const store = new Store<StoreSchema>({
  name: "credentials",
  encryptionKey: "aryazos-study-sync-secure-key",
});

export function getCredentials(): Credentials {
  const schoolId = store.get("selectedSchool") || "fhgr";
  return store.get(`schools.${schoolId}`) || {};
}

export function setCredentials(creds: Credentials): void {
  const schoolId = store.get("selectedSchool") || "fhgr";
  store.set(`schools.${schoolId}.username`, creds.username || "");
  store.set(`schools.${schoolId}.password`, creds.password || "");
  store.set("selectedSchool", schoolId);
}

export function hasCredentials(): boolean {
  const creds = getCredentials();
  return Boolean(creds.username && creds.password);
}

export function getPreferences(): Preferences {
  return store.get("preferences") || { autoLogin: true };
}

export function setPreferences(next: Partial<Preferences>): Preferences {
  const current = getPreferences();
  const merged = { ...current, ...next };
  store.set("preferences", merged);
  return merged;
}
