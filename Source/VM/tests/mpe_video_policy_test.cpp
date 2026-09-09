// SPDX-License-Identifier: MIT
#include "../video/mpe_video_policy.h"

#include <assert.h>
#include <stdio.h>

using mpe_video::CapabilityMask;
using mpe_video::PackagePolicy;
using mpe_video::PresentationPolicy;
using mpe_video::RenderMode;
using mpe_video::Selector;

static void scan_mapping() {
    Selector selector = Selector::Sharp;
    assert(mpe_video::selector_for_scan(0x3b, selector));
    assert(selector == Selector::Default);
    assert(mpe_video::selector_for_scan(0x3d, selector));
    assert(selector == Selector::Auto8);
    assert(mpe_video::selector_for_scan(0x3f, selector));
    assert(selector == Selector::Enhanced25);
    assert(mpe_video::selector_for_scan(0x41, selector));
    assert(selector == Selector::Sharp);

    const uint8_t invalid_scans[] = {0x3c, 0x3e, 0x40, 0x42, 0xff};
    for (uint8_t scan : invalid_scans) {
        selector = Selector::Auto8;
        assert(!mpe_video::selector_for_scan(scan, selector));
        assert(selector == Selector::Auto8);
    }
}

static PackagePolicy general_policy() {
    return mpe_video::indexed_video_policy();
}

static void capabilities() {
    const PackagePolicy package = general_policy();
    assert(package.supports(RenderMode::Color));
    assert(package.supports(RenderMode::Auto8));
    assert(package.supports(RenderMode::Enhanced25));
    assert(package.supports(RenderMode::Sharp));
    assert(!package.supports(RenderMode::Native));
    assert(mpe_video::all_capabilities() == 0x1f);

    // The preferred presentation is always a valid Default target, even if a
    // package author omits its bit from the supplied capability mask.
    const PackagePolicy repaired(RenderMode::Sharp, 0);
    assert(repaired.supports(RenderMode::Sharp));

    const RenderMode invalid_mode = static_cast<RenderMode>(0xff);
    assert(!mpe_video::valid_render_mode(invalid_mode));
    assert(mpe_video::capability(invalid_mode) == 0);
    assert(!package.supports(invalid_mode));

    // Corrupt manifest values fall back to the safe Color presentation and
    // unknown capability bits never escape the supported-mode mask.
    const PackagePolicy malformed(invalid_mode, 0xff);
    assert(malformed.preferred == RenderMode::Color);
    assert(malformed.capabilities == mpe_video::all_capabilities());
}

static void reset_and_default() {
    PresentationPolicy policy(general_policy());
    assert(policy.current() == RenderMode::Color);
    assert(policy.select(Selector::Sharp));
    assert(policy.current() == RenderMode::Sharp);
    policy.reset();
    assert(policy.current() == RenderMode::Color);

    assert(policy.select(Selector::Auto8));
    assert(policy.select(Selector::Default));
    assert(policy.current() == RenderMode::Color);
}

static void rejected_modes_preserve_current() {
    const PackagePolicy limited(
        RenderMode::Color,
        CapabilityMask(mpe_video::capability(RenderMode::Color) |
                       mpe_video::capability(RenderMode::Sharp)));
    PresentationPolicy policy(limited);
    assert(policy.select(Selector::Sharp));
    assert(!policy.select(Selector::Auto8));
    assert(policy.current() == RenderMode::Sharp);
    assert(!policy.select(Selector::Enhanced25));
    assert(policy.current() == RenderMode::Sharp);
}

static void direct_selection_is_idempotent() {
    PresentationPolicy policy(general_policy());
    assert(policy.select(Selector::Auto8));
    assert(policy.current() == RenderMode::Auto8);
    assert(policy.select(Selector::Auto8));
    assert(policy.current() == RenderMode::Auto8);

    assert(policy.select(Selector::Sharp));
    assert(policy.current() == RenderMode::Sharp);
    assert(policy.select(Selector::Sharp));
    assert(policy.current() == RenderMode::Sharp);

    assert(!policy.select(static_cast<Selector>(0xff)));
    assert(policy.current() == RenderMode::Sharp);
}

static void agi_native_only() {
    const PackagePolicy package = mpe_video::native_only_policy();
    PresentationPolicy policy(package);
    assert(policy.current() == RenderMode::Native);
    assert(package.supports(RenderMode::Native));
    assert(!package.supports(RenderMode::Color));
    assert(!policy.select(Selector::Auto8));
    assert(!policy.select(Selector::Enhanced25));
    assert(!policy.select(Selector::Sharp));
    assert(policy.current() == RenderMode::Native);
    assert(policy.select(Selector::Default));
    assert(policy.current() == RenderMode::Native);
}

static void initial_vm_rollout_scope() {
    // Indexed-video clients opt into the same package-agnostic contract.
    const PackagePolicy opted_in[] = {
        mpe_video::indexed_video_policy(),
        mpe_video::indexed_video_policy(),
        mpe_video::indexed_video_policy()
    };
    for (const PackagePolicy &package : opted_in) {
        assert(package.capabilities == mpe_video::indexed_video_capabilities());
        assert(package.supports(RenderMode::Color));
        assert(package.supports(RenderMode::Auto8));
        assert(package.supports(RenderMode::Enhanced25));
        assert(package.supports(RenderMode::Sharp));
        assert(!package.supports(RenderMode::Native));
    }

    const PackagePolicy agi = mpe_video::native_only_policy();
    assert(agi.capabilities == mpe_video::capability(RenderMode::Native));
}

int main() {
    scan_mapping();
    capabilities();
    reset_and_default();
    rejected_modes_preserve_current();
    direct_selection_is_idempotent();
    agi_native_only();
    initial_vm_rollout_scope();
    puts("PASS: firmware presentation policy mapping, capabilities, defaults, rejection and direct selection");
    return 0;
}
