import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import MetadataCard from "./MetadataCard.vue";

describe("MetadataCard", () => {
  it("renders title correctly", () => {
    const wrapper = mount(MetadataCard, {
      props: {
        title: "Session Statistics",
        sections: [],
      },
    });

    expect(wrapper.find(".metadata-header").text()).toBe("Session Statistics");
  });

  it("renders sections with items", () => {
    const wrapper = mount(MetadataCard, {
      props: {
        title: "Test",
        sections: [
          {
            title: "Token Usage",
            items: [
              { key: "Input", value: "100" },
              { key: "Output", value: "50" },
            ],
          },
        ],
      },
    });

    expect(wrapper.find(".stat-section-title").text()).toBe("Token Usage");
    expect(wrapper.findAll(".stat-item")).toHaveLength(2);
    expect(wrapper.findAll(".stat-key")[0].text()).toBe("Input");
    expect(wrapper.findAll(".stat-val")[0].text()).toBe("100");
  });

  it("applies highlight modifier correctly", () => {
    const wrapper = mount(MetadataCard, {
      props: {
        title: "Test",
        sections: [
          {
            title: "Stats",
            items: [
              { key: "Total", value: "150", modifier: "highlight" },
            ],
          },
        ],
      },
    });

    const statItem = wrapper.find(".stat-item");
    expect(statItem.classes()).toContain("highlight");
  });

  it("renders inline stat row", () => {
    const wrapper = mount(MetadataCard, {
      props: {
        title: "Test",
        sections: [
          {
            title: "Stats",
            layout: "inline",
            items: [
              { key: "A", value: "1" },
              { key: "B", value: "2" },
            ],
          },
        ],
      },
    });

    expect(wrapper.find(".stat-row-inline").exists()).toBe(true);
  });
});