# -*- coding: utf-8 -*-
# Copyright 2020 ACSONE SA/NV
# License AGPL-3.0 or later (http://www.gnu.org/licenses/agpl).

from odoo import _, api, fields, models
from odoo.exceptions import UserError
from odoo.fields import Date

from .mis_kpi_data import intersect_days


class ProRataReadGroupMixin(models.AbstractModel):
    _name = "prorata.read_group.mixin"
    _description = "Adapt model with date_from/date_to for pro-rata temporis read_group"

    date_from = fields.Date(required=True)
    date_to = fields.Date(required=True)
    date = fields.Date(
        compute=lambda self: None,
        search="_search_date",
        help=(
            "Dummy field that adapts searches on date "
            "to searches on date_from/date_to."
        ),
    )

    def _search_date(self, operator, value):
        if operator in (">=", ">"):
            return [("date_to", operator, value)]
        elif operator in ("<=", "<"):
            return [("date_from", operator, value)]
        raise UserError(
            _("Unsupported operator %s for searching on date") % (operator,)
        )

    @api.model
    def _intersect_days(self, item_dt_from, item_dt_to, dt_from, dt_to):
        return intersect_days(item_dt_from, item_dt_to, dt_from, dt_to)

    @api.model
    def read_group(
        self, domain, fields, groupby, offset=0, limit=None, orderby=False, lazy=True
    ):
        """Override read_group to perform pro-rata temporis adjustments.

        When read_group is invoked with a domain that filters on
        a time period (date >= from and date <= to, or
        date_from <= to and date_to >= from), adjust the accumulated
        values pro-rata temporis.

        Aggregation is performed in a single SQL statement:
            SUM(field * overlap_days / NULLIF(item_days, 0))
        with
            overlap_days = LEAST(date_to, period_to) - GREATEST(date_from, period_from) + 1
            item_days    = date_to - date_from + 1
        Advanced cases (offset, limit, orderby, lazy groupby, ``field:granularity``
        in ``fields``) fall back to the parent ``read_group`` (no prorata).
        """
        date_from = None
        date_to = None
        assert isinstance(domain, list)
        for domain_item in domain:
            if isinstance(domain_item, (list, tuple)):
                field, op, value = domain_item
                if field == "date" and op == ">=":
                    date_from = value
                elif field == "date_to" and op == ">=":
                    date_from = value
                elif field == "date" and op == "<=":
                    date_to = value
                elif field == "date_from" and op == "<=":
                    date_to = value

        if (
            date_from is None
            or date_to is None
            or any(":" in f for f in fields)
            or offset
            or limit
            or orderby
            or lazy
        ):
            return super(ProRataReadGroupMixin, self).read_group(
                domain,
                fields,
                groupby,
                offset=offset,
                limit=limit,
                orderby=orderby,
                lazy=lazy,
            )

        # Normalise groupby to a list (Odoo accepts a string or a list)
        if isinstance(groupby, str):
            groupby_list = [groupby]
        else:
            groupby_list = list(groupby)
        sum_fields = [f for f in fields if f not in groupby_list]
        if not sum_fields:
            return super(ProRataReadGroupMixin, self).read_group(
                domain,
                fields,
                groupby,
                offset=offset,
                limit=limit,
                orderby=orderby,
                lazy=lazy,
            )

        query = self._where_calc(domain)
        self._apply_ir_rules(query, "read")
        from_clause, where_clause, where_params = query.get_sql()

        table = self._table

        select_parts = []
        for g in groupby_list:
            select_parts.append('"%s"."%s" AS "%s"' % (table, g, g))
        for f in sum_fields:
            select_parts.append(
                ('COALESCE(SUM("%(t)s"."%(f)s"::numeric * '
                 'GREATEST(0, LEAST("%(t)s"."date_to", %%s::date) - '
                 'GREATEST("%(t)s"."date_from", %%s::date) + 1) / '
                 'NULLIF(("%(t)s"."date_to" - "%(t)s"."date_from" + 1), 0)'
                 '), 0) AS "%(f)s"')
                % {"t": table, "f": f}
            )
        groupby_clause = ", ".join(
            '"%s"."%s"' % (table, g) for g in groupby_list
        )

        sql = 'SELECT %s FROM %s WHERE %s GROUP BY %s' % (
            ", ".join(select_parts),
            from_clause,
            where_clause or 'TRUE',
            groupby_clause,
        )

        # Each prorata SUM expression has 2 placeholders: date_to, date_from
        params = []
        for _f in sum_fields:
            params.extend([date_to, date_from])
        params.extend(where_params)

        self._cr.execute(sql, params)
        rows = self._cr.dictfetchall()

        # For M2O groupby fields vanilla read_group returns (id, display_name).
        field_objs = {g: self._fields.get(g) for g in groupby_list}
        m2o_groupby = [
            g for g, fobj in field_objs.items()
            if fobj is not None and fobj.type == 'many2one'
        ]
        if m2o_groupby:
            ids_by_field = {g: set() for g in m2o_groupby}
            for row in rows:
                for g in m2o_groupby:
                    if row[g]:
                        ids_by_field[g].add(row[g])
            names_by_field = {}
            for g, ids in ids_by_field.items():
                comodel_name = field_objs[g].comodel_name
                names_by_field[g] = dict(
                    self.env[comodel_name].browse(list(ids)).name_get()
                )
            for row in rows:
                for g in m2o_groupby:
                    rid = row[g]
                    if rid:
                        row[g] = (rid, names_by_field[g].get(rid, ''))

        # psycopg2 returns Decimal for numeric sums; consumers expect float.
        for row in rows:
            for f in sum_fields:
                if row[f] is not None:
                    row[f] = float(row[f])

        return rows
