-- MOTDs stored here
create table if not exists motd
(
    id        int primary key generated always as identity,
    content   text,
    posted_at timestamp default now()
);

-- Shows last MOTD
create or replace function show_motd() returns setof omni_httpd.http_response as
$$
select
    omni_httpd.http_response('Posted at ' || posted_at || E'\n' || content)
from
    motd
order by
    posted_at desc
limit 1;
$$ language sql;

-- Shows when there are no MOTDs
create or replace function no_motd() returns setof omni_httpd.http_response as
$$
select omni_httpd.http_response('No MOTD');
$$
    language sql;

-- Creates a new MOTD 
create or replace function update_motd(request omni_httpd.http_request) returns omni_httpd.http_response as
$$
insert
into
    motd (content)
values
    (convert_from(request.body, 'UTF8'))
returning omni_httpd.http_response(status => 201);
$$
    language sql;

-- Handlers
update omni_httpd.handlers
set
    query = (select
                 omni_httpd.cascading_query(name, query order by priority desc nulls last)
             from
                 (values
                      -- GET
                      ('show', $$select show_motd() from request where request.method = 'GET'$$, 1),
                      -- POST
                      ('update', $$select update_motd(request.*) from request where request.method = 'POST'$$, 1),
                      -- No MOTDs
                      ('fallback', $$select no_motd() from request where request.method = 'GET'$$,
                       0)) handlers(name, query, priority));
