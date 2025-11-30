# keyvalue-jsondb
*`fast`, `secure`, `private`, and `memory leak resistant` `in-memory` `key-value` `(closure encapsulated)` `json based` `datastore or database` that supports `http`, `https`, `ws`, `wss`, and a `command shell (without or with [todo] authentication)` and is `extendible with expressjs middlewares`*


##### indevelopment - do not use in production


please note: `redis-like` is an inference most of the shell commands are like redis but a few changes have been made to accomodate the architecture. 


- <a name="features">Features</a>
- <a name="usage">Usage</a>
- <a name="rundb">Running the Database Server</a>
  - <a name="rundbdefaults">with defaults</a>
  - <a name="rundbnouserpass">with no username/password</a>
  - <a name="rundbuserpass">with username/password</a>
  - <a name="rundbwithoutkeys">without keys</a>
  - <a name="rundbwithkeys">with keys</a>
- <a name="runshell">Running the Database Shell</a>
  - <a name="runshelldefaults">with defaults</a>
  - <a name="runshellnouserpass">with no username/password</a>
  - <a name="runshelluserpass">with username/password</a>
  - <a name="runshellwithoutkeys">without keys</a>
  - <a name="runshellwithkeys">with keys</a>
- <a name="shellcommands">Shell Commands</a>
  - <a name="shellcommandsbasic">Shell Commands - Basic Usage</a>
- <a name="jsondbclient">jsondb client - client api</a>
  - <a name="jsondbclient">Client API</a>
  - <a name="jsondbclientrequeststructures">Request Structures</a> (any language API)
- <a name="architecturedocs">Architecture Docs</a>
  - <a name="architecturedocsdesign">Basic Design - Architecture of kvjsondb</a>
  - <a name="architecturedocsstorage">kvjsondb Basic Storage</a>
- <a name="securitychecks">Security Checks and Consideration</a>
- <a name="todo">TODO</a>





##### run shell or login to shell with [a] defaults


- `node db.js` *(default, starts shell)*



##### run shell or login to shell with [b] no username/password


- `node db.js` *(default, starts shell)*

- `node db.js -s "shell"` *(starts shell)*

- `node db.js -t "type"` *(default, starts shell with type)*

- `node db.js -p "port"`

- `node db.js -ip "ip"`

- `node db.js -t "type" -p "port"`

- `node db.js -t "type" -ip "ip"`

- `node db.js -p "port" -ip "ip"`

- `node db.js -t "type" -p "port" -ip "ip"`

- `node db.js -s "shell" -t "type"`

- `node db.js -s "shell" -p "port"`

- `node db.js -s "shell" -ip "ip"`

- `node db.js -s "shell" -t "type" -p "port"`

- `node db.js -s "shell" -t "type" -ip "ip"`

- `node db.js -s "shell" -p "port" -ip "ip"`

- `node db.js -s "shell" -t "type" -p "port" -ip "ip"`

example:

- `node db.js -s "shell" -t "ws" -p "4567" -ip "127.0.0.1"`



##### run shell or login to shell with [c] with username/password


- `node db.js -u "user" -pwd "pass"`

- `node db.js -t "type" -u "user" -pwd "pass"`

- `node db.js -p "port" -u "user" -pwd "pass"`

- `node db.js -ip "ip" -u "user" -pwd "pass"`

- `node db.js -t "type" -p "port" -u "user" -pwd "pass"`

- `node db.js -t "type" -ip "ip" -u "user" -pwd "pass"`

- `node db.js -p "port" -ip "ip" -u "user" -pwd "pass"`

- `node db.js -t "type" -p "port" -ip "ip" -u "user" -pwd "pass"`

- `node db.js -s "shell" -u "user" -pwd "pass"`

- `node db.js -s "shell" -t "type" -u "user" -pwd "pass"`

- `node db.js -s "shell" -p "port" -u "user" -pwd "pass"`

- `node db.js -s "shell" -ip "ip" -u "user" -pwd "pass"`

- `node db.js -s "shell" -t "type" -p "port" -u "user" -pwd "pass"`

- `node db.js -s "shell" -t "type" -ip "ip" -u "user" -pwd "pass"`

- `node db.js -s "shell" -p "port" -ip "ip" -u "user" -pwd "pass"`

- `node db.js -s "shell" -t "type" -p "port" -ip "ip" -u "user" -pwd "pass"`

example:

- `node db.js -s "shell" -t "http" -p "4567" -ip "127.0.0.1" -u "user_name" -pwd "password"`



##### run shell or login to shell with [c] certificate


- `node db.js -k "./fldr/key"`

- `node db.js -t "type" -k "./fldr/key"`

- `node db.js -p "port" -k "./fldr/key"`

- `node db.js -ip "ip" -k "./fldr/key"`

- `node db.js -t "type" -p "port" -k "./fldr/key"`

- `node db.js -t "type" -ip "ip" -k "./fldr/key"`

- `node db.js -p "port" -ip "ip" -k "./fldr/key"`

- `node db.js -t "type" -p "port" -ip "ip" -k "./fldr/key"`

- `node db.js -s "shell" -k "./fldr/key"`

- `node db.js -s "shell" -p "port" -k "./fldr/key"`

- `node db.js -s "shell" -ip "ip" -k "./fldr/key"`

- `node db.js -s "shell" -t "type" -k "./fldr/key"`

- `node db.js -s "shell" -t "type" -p "port" -k "./fldr/key"`

- `node db.js -s "shell" -t "type" -ip "ip" -k "./fldr/key"`

- `node db.js -s "shell" -p "port" -ip "ip" -k "./fldr/key"`

- `node db.js -s "shell" -t "type" -p "port" -ip "ip" -k "./fldr/key"`

example:

- `node db.js -s "shell" -t "https" -p "4567" -ip "127.0.0.1" -k "./fldr/key"`



### Shell [ commands, usage ] - kvjsondb 

`node db.js ...flags...`


##### ...flags...


`prefix: "-p" port [default: 4567]`

`prefix: "-t", server protocol [default: ws, will enable http and ws]`

`prefix: "-ip", ip address [default: 127.0.0.1]`

`prefix: "-k", key path [default: none, will enable http or ws]` (consider generate as default)

`prefix: "-c", certificate path [default: none, will enable use http or ws]` (consider generate as default)

`prefix: "-u", user [default: blank]`

`prefix: "-pwd", password [default: blank]`

`prefix: "-s", db server or shell [default: shell, options: shell or db]`


##### defaults


- `shell` (`-s`) options: `shell`, `db` [*default: `shell`*]
- `type` (`-t`) options: `http`, `https`, `ws`, `wss` [*default: `ws`*] (consider enabling all protocols)
- `port` (`-p`) options: [default: `4567` or provided `custom port`]
- `ip` (`-ip`) options: [default: `127.0.0.1` / `192.168.1.1`] or provided `custom ip address`
- `key` (`-k`)/ `cert` (`-c`) options: [default: `generate` `public and private key pair` for db server] 



### Start Shell Command


`node db.js` (starts shell, unless `-s "db"` is provided)

`node db.js -p "port"`

`node db.js -ip "ip"`

`node db.js -p "port" -ip "ip"`

`node db.js -p "port" -ip "ip" -t "type"`



### Shell Commands


###### set
\> `set key value`

*example\>* `set test 10`


###### get
\> `get key`

*example\>* `get test`


###### has
\> `has key`

*example\>* `has test`


###### search
\> `search string`

*example\>* `search test`


###### search
\> `search -v string`

*example\>* `search -v 10`


###### search
\> `search -k string`

*example\>* `search -k test`


###### search
\> `search -kv string`

*example\>* `search -kv test`


###### load
\> `load -f filename`

*example\>* `load -f "./dump/filename.json"`


###### load
\> `load jsonobject`

*example\>* `load "{'test': 10}"`


###### read
\> `read key`

*example\>* `read test`


###### clear
\> `clear`

*example\>* `clear`


###### init
\> `init -f filename`

*example\>* `init -f "./dump/filename.json"`


###### init
\> `init jsonobject`

*example\>* `init "{'test': 10}"`


###### update
\> `update -f filename`

*example\>* `update -f "./dump/filename.json"`


###### update
\> `update jsonobject`

*example\>* `update "{"test": 10}"`


###### del
\> `del key`

*example\>* `del test`


###### dump
\> `dump -f "filename/within/quotes"`

*example\>* `dump -f "./dump/filename.json"`



#### TODO

add docs for other features
