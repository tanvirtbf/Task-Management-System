import type { CustomField } from "../../types/custom-fields";
import {
    TextFieldRenderer,
    LongTextFieldRenderer,
    EmailFieldRenderer,
    UrlFieldRenderer,
    PhoneFieldRenderer,
} from "./fields/TextFields";
import {
    NumberFieldRenderer,
    MoneyFieldRenderer,
    RatingFieldRenderer,
    ProgressFieldRenderer,
} from "./fields/NumericFields";
import {
    DropdownFieldRenderer,
    LabelsFieldRenderer,
    CheckboxFieldRenderer,
} from "./fields/SelectionFields";
import { DateFieldRenderer } from "./fields/DateField";
import { PeopleFieldRenderer } from "./fields/PeopleField";
import { FilesFieldRenderer } from "./fields/FilesField";
import { LocationFieldRenderer } from "./fields/LocationField";
import { FormulaFieldRenderer } from "./fields/FormulaField";

interface CustomFieldRendererProps {
    field: CustomField;
    value: unknown;
    onChange: (next: unknown) => void;
    disabled?: boolean;
    autoFocus?: boolean;
}

/**
 * Central dispatcher — switches on `field.type` and renders the right
 * input component. Used by TaskDetailDrawer custom-fields section and
 * by the public Form page.
 */
export const CustomFieldRenderer = (props: CustomFieldRendererProps) => {
    switch (props.field.type) {
        case "text":
            return <TextFieldRenderer {...props} />;
        case "long_text":
            return <LongTextFieldRenderer {...props} />;
        case "email":
            return <EmailFieldRenderer {...props} />;
        case "url":
            return <UrlFieldRenderer {...props} />;
        case "phone":
            return <PhoneFieldRenderer {...props} />;
        case "number":
            return <NumberFieldRenderer {...props} />;
        case "money":
            return <MoneyFieldRenderer {...props} />;
        case "rating":
            return <RatingFieldRenderer {...props} />;
        case "progress":
            return <ProgressFieldRenderer {...props} />;
        case "dropdown":
            return <DropdownFieldRenderer {...props} />;
        case "labels":
            return <LabelsFieldRenderer {...props} />;
        case "checkbox":
            return <CheckboxFieldRenderer {...props} />;
        case "date":
            return <DateFieldRenderer {...props} />;
        case "people":
            return <PeopleFieldRenderer {...props} />;
        case "files":
            return <FilesFieldRenderer {...props} />;
        case "location":
            return <LocationFieldRenderer {...props} />;
        case "formula":
            return (
                <FormulaFieldRenderer
                    field={props.field}
                    value={props.value}
                />
            );
        default:
            return (
                <span style={{ color: "#94A3B8", fontSize: 12 }}>
                    Unsupported field type: {String(props.field.type)}
                </span>
            );
    }
};
