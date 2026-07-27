-- Page content type enum
CREATE TYPE page_kind AS ENUM ('document', 'group', 'link');

-- Page publish status
CREATE TYPE page_status AS ENUM ('draft', 'published');

-- Cover image display style
CREATE TYPE cover_style AS ENUM ('full', 'content');
