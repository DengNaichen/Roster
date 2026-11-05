alter table roster.issues
  add column document jsonb not null default '{"lead":"","sections":[],"criteria":[]}'::jsonb
    check (jsonb_typeof(document) = 'object'),
  add column document_text text not null default '';

-- Must match documentFromDescription in packages/backend/src/modules/issues/domain/document.ts:
-- JavaScript trim(), then the longest prefix that fits the 5000 UTF-16 unit paragraph limit.
create function pg_temp.legacy_paragraph(description text) returns text language plpgsql immutable as $$
declare
  space constant text := '[\t\n\v\f\r    -     　﻿]';
  value text := regexp_replace(description, '^' || space || '+|' || space || '+$', '', 'g');
  n integer := least(length(value), 5000);
begin
  while n > 0 and n + regexp_count(left(value, n), '[\U00010000-\U0010ffff]') > 5000 loop
    n := n - 1;
  end loop;
  return regexp_replace(left(value, n), space || '+$', '');
end $$;

update roster.issues i
set document = jsonb_build_object(
      'lead', '',
      'sections', jsonb_build_array(jsonb_build_object(
        'title', 'Description',
        'blocks', jsonb_build_array(jsonb_build_object('type', 'paragraph', 'text', l.paragraph))
      )),
      'criteria', '[]'::jsonb
    ),
    document_text = 'Description' || E'\n' || l.paragraph
from (select id, pg_temp.legacy_paragraph(description) as paragraph from roster.issues) l
where l.id = i.id and l.paragraph <> '';

alter table roster.issues drop column description;
