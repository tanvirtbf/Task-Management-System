import type { CustomField } from "../../types/custom-fields";
import { TextFieldRenderer, PhoneFieldRenderer } from "./fields/TextFields";
import { MoneyFieldRenderer } from "./fields/NumericFields";
import { DropdownFieldRenderer } from "./fields/SelectionFields";
import { DateFieldRenderer } from "./fields/DateField";
import { FilesFieldRenderer } from "./fields/FilesField";

interface CustomFieldRendererProps {
  field: CustomField;
  value: unknown;
  onChange: (next: unknown) => void;
  disabled?: boolean;
  autoFocus?: boolean;
}

/**
 * Central dispatcher — switches on `field.type` and renders the right
 * input component. Restricted to the 6 types BeautyBooth needs.
 */
export const CustomFieldRenderer = (props: CustomFieldRendererProps) => {
  switch (props.field.type) {
    case "text":
      return <TextFieldRenderer {...props} />;
    case "phone":
      return <PhoneFieldRenderer {...props} />;
    case "money":
      return <MoneyFieldRenderer {...props} />;
    case "date":
      return <DateFieldRenderer {...props} />;
    case "dropdown":
      return <DropdownFieldRenderer {...props} />;
    case "files":
      return <FilesFieldRenderer {...props} />;
    default:
      return (
        <span style={{ color: "#94A3B8", fontSize: 12 }}>
          Unsupported field type: {String(props.field.type)}
        </span>
      );
  }
};
