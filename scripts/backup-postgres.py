"""Create an atomic pg_dump archive; keep the latest 14 daily backups by default."""
import argparse, datetime, os, subprocess, tempfile
from pathlib import Path
from urllib.parse import urlsplit, unquote, parse_qs

parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('directory');parser.add_argument('--keep',type=int,default=14)
args=parser.parse_args()
if args.keep<1: raise SystemExit('--keep must be positive')
if not os.environ.get('DATABASE_URL'): raise SystemExit('DATABASE_URL is required')
directory=Path(args.directory);directory.mkdir(parents=True,exist_ok=True)
target=directory/f'daily-{datetime.datetime.now(datetime.timezone.utc):%Y-%m-%d}.dump'
if target.exists(): print(target);raise SystemExit(0)
fd,temp=tempfile.mkstemp(prefix='.backup-',dir=directory);os.close(fd)
try:
    connection=urlsplit(os.environ['DATABASE_URL'])
    if connection.scheme not in ('postgres','postgresql') or not connection.hostname:
        raise ValueError('DATABASE_URL must be a Postgres URL')
    env={**os.environ,'PGDATABASE':unquote(connection.path.lstrip('/')),'PGHOST':connection.hostname,'PGPORT':str(connection.port or 5432)}
    if connection.username:env['PGUSER']=unquote(connection.username)
    if connection.password:env['PGPASSWORD']=unquote(connection.password)
    for option,key in {'sslmode':'PGSSLMODE','sslrootcert':'PGSSLROOTCERT','sslcert':'PGSSLCERT','sslkey':'PGSSLKEY','connect_timeout':'PGCONNECT_TIMEOUT'}.items():
        if option in parse_qs(connection.query):env[key]=parse_qs(connection.query)[option][-1]
    subprocess.run(['pg_dump','--no-password','--format=custom','--no-owner','--no-acl','--file',temp],env=env,check=True)
    with open(temp,'rb') as f: os.fsync(f.fileno())
    os.replace(temp,target)
    for old in sorted(directory.glob('daily-????-??-??.dump'),reverse=True)[args.keep:]: old.unlink()
    print(target)
finally:
    if os.path.exists(temp):os.unlink(temp)
