import fs from "node:fs";
import path from "node:path";

const EMPTY_DATABASE = {
  users: [],
  sessions: [],
  presentations: [],
  jumpContents: [],
  auditEvents: []
};

export class JsonDatabase {
  constructor(filePath) {
    this.filePath = filePath;
    this.data = structuredClone(EMPTY_DATABASE);
  }

  load() {
    if (fs.existsSync(this.filePath)) {
      this.data = { ...structuredClone(EMPTY_DATABASE), ...JSON.parse(fs.readFileSync(this.filePath, "utf8")) };
    } else {
      this.save();
    }
    return this.data;
  }

  save() {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    const temporary = `${this.filePath}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify(this.data, null, 2), { mode: 0o600 });
    fs.renameSync(temporary, this.filePath);
  }

  mutate(operation) {
    const result = operation(this.data);
    this.save();
    return result;
  }
}
