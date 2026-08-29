-- Useful once you have a few weeks of data. Run in the SQL editor.

-- 7-day rolling weight average
select day,
       (data->>'weight')::numeric as weight,
       round(avg((data->>'weight')::numeric)
             over (order by day rows between 6 preceding and current row), 2) as avg7
from entries
where data ? 'weight'
order by day;

-- protein adherence against the 130 g target
select date_trunc('week', day)::date as week,
       round(avg((data->>'protein')::numeric)) as avg_protein,
       count(*) filter (where (data->>'protein')::numeric >= 130) as days_on_target,
       count(*) as days_logged
from entries
where data ? 'protein'
group by 1 order by 1;

-- waist trend
select day, (data->>'waist')::numeric as waist
from entries where data ? 'waist' order by day;

-- personal records
select best from profile;
