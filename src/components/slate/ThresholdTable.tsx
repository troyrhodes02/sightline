"use client";

import Box from "@mui/material/Box";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import Typography from "@mui/material/Typography";
import { StatusChip } from "@/components/primitives/StatusChip";
import type { PropDto } from "@/lib/dto/slate";
import {
  ConfidenceValue,
  EdgeValue,
  PriceValue,
  ProbabilityValue,
} from "./values";

/**
 * The dense per-stat threshold table on an expanded player card (Screen 2). One
 * row per listed threshold plus the complementary below row — all values come
 * from the props already delivered to the client (RD-1); selecting a row is
 * local re-emphasis, NEVER a refetch or a model run.
 *
 * Every value keeps its provenance and greyscale-safe encoding: probability in
 * model accent, price in market mint, edge with sign + glyph, confidence as a
 * word. A below row that has no listed market shows an em dash in price/edge —
 * absence, not zero.
 */
export function ThresholdTable({
  props,
  selectedKey,
  onSelect,
}: {
  props: PropDto[];
  /** `${direction}:${threshold}` of the active prop — pre-set to the best. */
  selectedKey: string;
  onSelect: (prop: PropDto) => void;
}) {
  return (
    <Table
      size="small"
      aria-label="Thresholds"
      sx={{ "& td, & th": { paddingBlock: 1, paddingInline: 1 } }}
    >
      <TableHead>
        <TableRow>
          <TableCell>Threshold</TableCell>
          <TableCell align="right">P</TableCell>
          <TableCell>Conf</TableCell>
          <TableCell align="right">Ask</TableCell>
          <TableCell align="right">Edge</TableCell>
          <TableCell>Rec</TableCell>
        </TableRow>
      </TableHead>
      <TableBody>
        {props.map((prop) => {
          const key = `${prop.direction}:${prop.threshold}`;
          const selected = key === selectedKey;
          const glyph = prop.direction === "above" ? "≥" : "<";
          return (
            <TableRow
              key={key}
              hover
              selected={selected}
              onClick={() => onSelect(prop)}
              tabIndex={0}
              aria-selected={selected}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  onSelect(prop);
                }
              }}
              sx={{
                cursor: "pointer",
                "&.Mui-selected": { bgcolor: "primary.soft" },
                "&.Mui-selected:hover": { bgcolor: "primary.soft" },
              }}
            >
              <TableCell>
                <Typography variant="numericSm" component="span">
                  {glyph} {prop.threshold}
                </Typography>{" "}
                <Typography
                  variant="numericSm"
                  component="span"
                  sx={{ color: "text.muted" }}
                >
                  {prop.direction}
                </Typography>
              </TableCell>
              <TableCell align="right">
                <ProbabilityValue value={prop.modelProbability} size="sm" />
              </TableCell>
              <TableCell>
                <ConfidenceValue confidence={prop.confidence} size="sm" />
              </TableCell>
              <TableCell align="right">
                <PriceValue cents={prop.askCents} size="sm" />
              </TableCell>
              <TableCell align="right">
                <EdgeValue points={prop.edgePoints} size="sm" />
              </TableCell>
              <TableCell>
                {prop.isRecommended ? (
                  <StatusChip label="rec" tone="accent" />
                ) : (
                  <Box component="span" aria-hidden>
                    {" "}
                  </Box>
                )}
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
