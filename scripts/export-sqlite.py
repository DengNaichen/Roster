"""Export a consistent, read-only InfTask SQLite snapshot. Never writes the source."""
import argparse, json, sqlite3
from pathlib import Path

TABLES = 'users workspaces workspace_members workspace_invites teams team_members projects project_teams initiatives initiative_projects label_groups labels team_cycle_settings cycles issues issue_labels comments work_logs issue_delegations relations links issue_assignments events pull_requests github_sync'.split()
def export(source, destination):
    uri = Path(source).resolve().as_uri() + '?mode=ro'
    db = sqlite3.connect(uri, uri=True)
    db.row_factory = sqlite3.Row
    try:
        db.execute('BEGIN')
        present = {r[0] for r in db.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        if not {'workspaces', 'teams', 'issues'}.issubset(present):
            raise ValueError('Expected a current InfTask database with workspaces/teams/issues')
        tables = {}
        for name in TABLES:
            tables[name] = [{k: (v.hex() if isinstance(v, bytes) else v) for k, v in dict(row).items()} for row in db.execute(f'SELECT * FROM "{name}"')] if name in present else []
        with open(destination, 'x', encoding='utf-8') as f:
            json.dump({'format': 'inftask-sqlite-v1', 'tables': tables}, f, ensure_ascii=False, indent=2)
        print(json.dumps({name: len(rows) for name, rows in tables.items()}))
    finally:
        db.close()

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('source'); parser.add_argument('destination')
    args = parser.parse_args(); export(args.source, args.destination)
